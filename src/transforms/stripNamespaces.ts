import * as path from "path";
import { createExportDeclaration, createIdentifier, createImportClause, createImportDeclaration, createLiteral, createNamespaceImport, createNode, createNodeArray, createStringLiteral, createToken, ExportDeclaration, idText, isModuleBlock, isModuleDeclaration, isPropertyAssignment, isStringLiteral, Node, NodeFlags, Program, SourceFile, Statement, SyntaxKind, TransformationContext, TypeChecker, updateSourceFileNode, visitEachChild, visitNodes, VisitResult, isArrayLiteralExpression, updatePropertyAssignment, updateArrayLiteral, LiteralExpression, StringLiteral } from "typescript";
import { ProjectTransformerConfig } from "..";

class NormalizedPathMap<T> extends Map<string, T> {
    has(key: string) {
        return super.has(path.normalize(key));
    }
    get(key: string) {
        return super.get(path.normalize(key));
    }
    set(key: string, value: T) {
        return super.set(path.normalize(key), value);
    }
}

class NormalizedPathSet extends Set<string> {
    add(key: string) {
        return super.add(path.normalize(key));
    }
    has(key: string) {
        return super.has(path.normalize(key));
    }
}

export function getStripNamespacesTransformFactoryFactory(config: ProjectTransformerConfig) {
    // TODO: Rather than using a `Set<string>` representing the files that need to be reexported,
    // we may need something more complex where we specify the specific names from that file
    // which should be reexported (to handle things like `namspace a {}` and `namespace b` in the same file)
    // Maps `proj/root/dir/namespace.path.ts` to `Set([file/to/be/reexported])`
    const newNamespaceFiles = new NormalizedPathMap<NormalizedPathSet>();
    const extraFilesFieldMembers = new NormalizedPathMap<NormalizedPathSet>();
    const configDeps = new NormalizedPathMap<NormalizedPathSet>();

    config.onTransformConfigFile = removePrependFromReferencesAndAddNamespacesToFiles;
    config.onTransformComplete = () => {
        // In each project we'll make a ns.ts file in the root (and ns.sub.ts and so on) who's
        // sole role is marshalling reexports into the right shape. In addition to reexporting the
        // local content, it needs to reexport the namespace of the same name from sub-projects
        // (should they contain it)
        return {
            additionalOutputFiles: !newNamespaceFiles.size ? undefined : createSourceFilesForMap(newNamespaceFiles)
        };
    }
    return getStripNamespacesTransformFactory;

    function createSourceFilesForMap(map: typeof newNamespaceFiles) {
        const results: SourceFile[] = [];
        map.forEach((reexports, filename) => {
            const reexportStatements: ExportDeclaration[] = [];
            const associatedConfig = [...extraFilesFieldMembers.entries()].find(([_, addedFiles]) => addedFiles.has(filename))![0];
            const dependentPaths = configDeps.get(associatedConfig);
            if (dependentPaths && dependentPaths.size) {
                dependentPaths.forEach(requiredProjectPath => {
                    const nsFileName = path.join(requiredProjectPath, path.basename(filename));
                    if (newNamespaceFiles.has(nsFileName)) {
                        reexportStatements.push(createExportDeclaration(
                            /*decorators*/ undefined,
                            /*modifiers*/ undefined,
                            /*namedExports*/ undefined,
                            createStringLiteral(getTSStyleRelativePath(filename, nsFileName).replace(".ts", ""))
                        ));
                    }
                });
            }
            reexports.forEach(exportingPath => {
                reexportStatements.push(createExportDeclaration(
                    /*decorators*/ undefined,
                    /*modifiers*/ undefined,
                    /*namedExports*/ undefined,
                    createStringLiteral(getTSStyleRelativePath(filename, exportingPath).replace(".ts", ""))
                ));
            });
            const newSource = createNode(SyntaxKind.SourceFile, -1, -1) as SourceFile; // There's no SourceFile factory, so this is what we get
            newSource.flags |= NodeFlags.Synthesized;
            newSource.fileName = filename;
            newSource.statements = createNodeArray(reexportStatements);
            newSource.endOfFileToken = createToken(SyntaxKind.EndOfFileToken);
            results.push(newSource);
        });
        return results;
    }

    function removePrependFromReferencesAndAddNamespacesToFiles(context: TransformationContext) {
        let currentSourceFile: SourceFile;
        return transformSourceFile;
        function transformSourceFile(file: SourceFile) {
            currentSourceFile = file;
            return visitEachChild(file, visitElement, context);
        }

        function visitElement(node: Node): VisitResult<Node> {
            if (isPropertyAssignment(node) && isStringLiteral(node.name)) {
                switch (node.name.text) {
                    case "outFile": return updatePropertyAssignment(node, createStringLiteral("outDir"), createLiteral(((node.initializer as StringLiteral).text).replace(".js", "")));
                    case "prepend": return undefined;
                    case "files": {
                        if (isArrayLiteralExpression(node.initializer) && extraFilesFieldMembers.has(currentSourceFile.fileName)) {
                            const newFileLiterals: LiteralExpression[] = [];
                            extraFilesFieldMembers.get(currentSourceFile.fileName)!.forEach(filepath => {
                                newFileLiterals.push(createLiteral(getTSStyleRelativePath(currentSourceFile.fileName, filepath)));
                            });
                            return updatePropertyAssignment(
                                node,
                                node.name,
                                updateArrayLiteral(
                                    node.initializer,
                                    [...node.initializer.elements, ...newFileLiterals]
                                )
                            );
                        }
                    }
                }
            }
            return visitEachChild(node, visitElement, context);
        }
    }

    function getStripNamespacesTransformFactory(checker: TypeChecker, program: Program) {
        const opts = program.getCompilerOptions();
        const configPath = (opts as {configFilePath?: string}).configFilePath!;
        const refs = program.getProjectReferences();
        if (refs) {
            configDeps.set(configPath, new Set(refs.map(r => r.path)));
        }
        const projRootDir = path.dirname(configPath);
        return stripNamespaces;
        function stripNamespaces(context: TransformationContext) {
            const requiredImports = new Set<string>();
            let currentSourceFile: SourceFile;
            return transformSourceFile;
            function transformSourceFile(file: SourceFile) {
                currentSourceFile = file;
                const statements = visitNodes(file.statements, visitStatements);
                return updateSourceFileNode(file, [...getRequiredImports(), ...statements]);
            }
    
            function getRequiredImports() {
                const importStatements: Statement[] = [];
                requiredImports.forEach(i => {
                    const nsFilePath = getTSStyleRelativePath(currentSourceFile.fileName, path.join(projRootDir, `${i}`));
                    importStatements.push(createImportDeclaration(
                        /*decorators*/ undefined,
                        /*modifiers*/ undefined,
                        createImportClause(/*name*/ undefined, createNamespaceImport(createIdentifier(i))),
                        createLiteral(nsFilePath)
                    ))
                });
                return importStatements;
            }
    
            function visitStatements(statement: Node): VisitResult<Node> {
                if (isModuleDeclaration(statement) && !isStringLiteral(statement.name) && statement.body) {
                    let body = statement.body;
                    let nsPath = [statement.name];
                    while (isModuleDeclaration(body) && body.body) {
                        nsPath.push(body.name);
                        body = body.body;
                    }
                    if (!isModuleBlock(body)) {
                        return statement;
                    }
                    requiredImports.add(idText(nsPath[0]));
                    const nsFilePath = `${projRootDir}/${nsPath.map(idText).join(".")}.ts`;
                    getOrCreateNamespaceSet({ namespaceFilePath: nsFilePath, configFilePath: configPath }).add(currentSourceFile.fileName);
                    return body.statements.slice();
                }
    
                return statement;
            }
        }
    }

    function getOrCreateNamespaceSet({namespaceFilePath, configFilePath}: {
        namespaceFilePath: string,
        configFilePath: string
    }) {
        const res = newNamespaceFiles.get(namespaceFilePath);
        if (res) {
            return res;
        }
        const s = new NormalizedPathSet();
        newNamespaceFiles.set(namespaceFilePath, s);
        let configRes = extraFilesFieldMembers.get(configFilePath);
        if (!configRes) {
            configRes = new NormalizedPathSet();
            extraFilesFieldMembers.set(configFilePath, configRes);
        }
        configRes.add(namespaceFilePath);
        return s;
    }
}

function getTSStyleRelativePath(from: string, to: string) {
    let result = path.normalize(path.relative(path.dirname(from), to));
    if (!result.startsWith(".")) {
        result = `./${result}`;
    }
    return result.replace(/\\/g, "/");
}