import * as path from "path";
import { createExportDeclaration, createIdentifier, createImportClause, createImportDeclaration, createLiteral, createNamespaceImport, createNode, createNodeArray, createStringLiteral, createToken, ExportDeclaration, idText, isModuleBlock, isModuleDeclaration, isPropertyAssignment, isStringLiteral, Node, NodeFlags, Program, SourceFile, Statement, SyntaxKind, TransformationContext, TypeChecker, updateSourceFileNode, visitEachChild, visitNodes, VisitResult, isArrayLiteralExpression, updatePropertyAssignment, updateArrayLiteral, LiteralExpression, StringLiteral, isExpressionStatement, isParenthesizedExpression, ExpressionStatement, ParenthesizedExpression, ImportDeclaration, createNamedExports, createExportSpecifier, isIdentifier, getNameOfDeclaration, isPropertyAccessExpression, isQualifiedName, Declaration, isInterfaceDeclaration, createModuleDeclaration, createModuleBlock, setSyntheticLeadingComments, isVariableStatement, setTextRange, createEmptyStatement, setEmitFlags, EmitFlags, sys, createNotEmittedStatement, getLeadingCommentRanges, getTrailingCommentRanges, SynthesizedComment, setSyntheticTrailingComments, forEachLeadingCommentRange, CommentKind, addSyntheticLeadingComment, addSyntheticTrailingComment, forEachTrailingCommentRange } from "typescript";
import { ProjectTransformerConfig } from "..";
import { removeUnusedNamespaceImports } from "./removeUnusedNamespaceImports";
import { getTSStyleRelativePath } from "./pathUtil";
import * as ts from "typescript";

function normalizePath(p: string) {
    return sys.useCaseSensitiveFileNames ? path.normalize(p).toLowerCase() : path.normalize(p);
}

class NormalizedPathMap<T> extends Map<string, T> {
    has(key: string) {
        return super.has(normalizePath(key));
    }
    get(key: string) {
        return super.get(normalizePath(key));
    }
    set(key: string, value: T) {
        return super.set(normalizePath(key), value);
    }
}

class NormalizedPathSet extends Set<string> {
    add(key: string) {
        return super.add(normalizePath(key));
    }
    has(key: string) {
        return super.has(normalizePath(key));
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
            const reexportStatements: (ExportDeclaration | ImportDeclaration)[] = [];
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
                            createStringLiteral(getTSStyleRelativePath(filename, nsFileName).replace(/\.ts$/, ""))
                        ));
                    }
                });
            }
            reexports.forEach(exportingPath => {
                reexportStatements.push(createExportDeclaration(
                    /*decorators*/ undefined,
                    /*modifiers*/ undefined,
                    /*namedExports*/ undefined,
                    createStringLiteral(getTSStyleRelativePath(filename, exportingPath).replace(/\.ts$/, ""))
                ));
            });
            const partsThis = path.basename(filename).slice(0, path.basename(filename).length - path.extname(filename).length).split(".");
            const currentNSName = partsThis.join(".");
            map.forEach((_, otherFilename) => {
                if (otherFilename !== filename && path.dirname(filename) === path.dirname(otherFilename)) {
                    const partsOther = path.basename(otherFilename).slice(0, path.basename(otherFilename).length - path.extname(otherFilename).length).split(".");
                    const otherNSParent = partsOther.slice(0, partsOther.length - 1).join(".");
                    if (otherNSParent && otherNSParent === currentNSName) {
                        reexportStatements.push(createImportDeclaration(
                            /*decorators*/ undefined,
                            /*modifiers*/ undefined,
                            createImportClause(/*name*/ undefined, createNamespaceImport(createIdentifier(partsOther[partsOther.length - 1]))),
                            createStringLiteral(getTSStyleRelativePath(filename, otherFilename).replace(/\.ts$/, ""))
                        ));
                        reexportStatements.push(createExportDeclaration(
                            /*decorators*/ undefined,
                            /*modifiers*/ undefined,
                            createNamedExports([createExportSpecifier(/*propertyName*/ undefined, partsOther[partsOther.length - 1])])
                        ));
                    }
                }
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
            const result = visitEachChild(file, visitElement, context);
            // TODO: Fix TS itself so a json source file doesn't present an invalid AST that can't rountdrip thru the factory system without getting extraneous parenthesis added
            if (result && isExpressionStatement(result.statements[0]) && isParenthesizedExpression((result.statements[0] as ExpressionStatement).expression)) {
                (result.statements[0] as ExpressionStatement).expression = ((result.statements[0] as ExpressionStatement).expression as ParenthesizedExpression).expression;
            }
            return result;
        }

        function visitElement(node: Node): VisitResult<Node> {
            if (isPropertyAssignment(node) && isStringLiteral(node.name)) {
                switch (node.name.text) {
                    case "outFile": {
                        const baseDir = path.basename(currentSourceFile.fileName).includes(".release.")
                            ? path.dirname((node.initializer as StringLiteral).text).replace("local", "local/release")
                            : path.dirname((node.initializer as StringLiteral).text);
                        return updatePropertyAssignment(node, createStringLiteral("outDir"), createLiteral(baseDir.replace(/\\/g, "/")));
                    }
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
        interface DocumentPosition {
            fileName: string;
            pos: number;
        }
        let sourceMapper: {
            toLineColumnOffset(fileName: string, position: number): {
                /** 0-based. */
                line: number;
                /*
                 * 0-based. This value denotes the character position in line and is different from the 'column' because of tab characters.
                 */
                character: number;
            };
            tryGetSourcePosition(info: DocumentPosition): DocumentPosition | undefined;
            tryGetGeneratedPosition(info: DocumentPosition): DocumentPosition | undefined;
            clearCache(): void;
        } | undefined;
        const getSourceMapper = () => sourceMapper || (sourceMapper = (ts as any).getSourceMapper({
            useCaseSensitiveFileNames() { return sys.useCaseSensitiveFileNames; },
            getCurrentDirectory() { return program.getCurrentDirectory() },
            getProgram() { return program; },
            fileExists: sys.fileExists,
            readFile: sys.readFile,
            log: (_log: string) => void 0,
        }));
        return stripNamespaces;
        function stripNamespaces(context: TransformationContext) {
            const requiredImports = new Set<string>();
            let currentSourceFile: SourceFile;
            return transformSourceFile;
            function transformSourceFile(file: SourceFile) {
                currentSourceFile = file;
                requiredImports.clear();
                const statements = visitNodes(file.statements, visitStatements);
                const result = setTextRange(createNodeArray(removeUnusedNamespaceImports([...getRequiredImports(), ...statements])), file.statements);
                // So the output is guaranteed to be a module, if we'd otherwise emit an empty file, emit `export {}`
                // (We'll go back and clean those up later)
                return updateSourceFileNode(file, result.length === 0 ? [createExportDeclaration(
                    /*decorators*/ undefined,
                    /*modifiers*/ undefined,
                    ts.createNamedExports([]),
                )] : result);
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

            function visitIdentifiers<T extends Node>(node: T): T {
                if (isIdentifier(node) &&
                    getNameOfDeclaration(node.parent as Declaration) !== node &&
                    !(isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
                    !(isQualifiedName(node.parent) && node.parent.right === node)
                ) {
                    const s = checker.getSymbolAtLocation(node);
                    if (s && s.declarations && s.declarations.some(d => isModuleDeclaration(d) && !!(d.flags & NodeFlags.Namespace))
                        && s.declarations.some(d => d.getSourceFile() !== currentSourceFile) // only namespaces external to the current file
                        && !s.declarations.some(d => d.getSourceFile().fileName.indexOf("lib.") !== -1) // that are not from the `lib`
                        && !s.declarations.some(d => d.getSourceFile().fileName.indexOf("node_modules") !== -1) // that are not from `node_modules`
                        && !s.declarations.some(d => d.kind === SyntaxKind.ClassDeclaration) // and nothing that's a class (we can't faithfully repreoduce class/ns merges anyway, so it's easy to toss these)
                    ) {
                        const nsName = checker.symbolToString(s);
                        requiredImports.add(nsName);
                    }
                }
                return visitEachChild(node, visitIdentifiers, context);
            }
    
            function copyLeadingComments(targetNode: Node, pos: number, sourceFile: SourceFile, commentKind?: CommentKind, hasTrailingNewLine?: boolean) {
                forEachLeadingCommentRange(sourceFile.text, pos, getAddCommentsFunction(targetNode, sourceFile, commentKind, hasTrailingNewLine, addSyntheticLeadingComment));
                return targetNode;
            }
        
        
            function copyTrailingComments(targetNode: Node, pos: number, sourceFile: SourceFile, commentKind?: CommentKind, hasTrailingNewLine?: boolean) {
                forEachTrailingCommentRange(sourceFile.text, pos, getAddCommentsFunction(targetNode, sourceFile, commentKind, hasTrailingNewLine, addSyntheticTrailingComment));
                return targetNode;
            }


            function getAddCommentsFunction(targetNode: Node, sourceFile: SourceFile, commentKind: CommentKind | undefined, hasTrailingNewLine: boolean | undefined, cb: (node: Node, kind: CommentKind, text: string, hasTrailingNewLine?: boolean) => void) {
                return (pos: number, end: number, kind: CommentKind, htnl: boolean) => {
                    if (kind === SyntaxKind.MultiLineCommentTrivia) {
                        // Remove leading /*
                        pos += 2;
                        // Remove trailing */
                        end -= 2;
                    }
                    else {
                        // Remove leading //
                        pos += 2;
                    }
                    cb(targetNode, commentKind || kind, sourceFile.text.slice(pos, end), hasTrailingNewLine !== undefined ? hasTrailingNewLine : htnl);
                };
            }

            function visitStatements(statement: Node): VisitResult<Node> {
                if (isModuleDeclaration(statement) && !isStringLiteral(statement.name) && statement.body) {
                    const originalStatement = statement;
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
                    for (let i = 1; i < nsPath.length; i++) {
                        const parentNsFile = `${projRootDir}/${nsPath.map(idText).slice(0, i).join(".")}.ts`;
                        getOrCreateNamespaceSet({ namespaceFilePath: parentNsFile, configFilePath: configPath });
                    }

                    const isInternal = (ts as any as { isInternalDeclaration(node: Node, currentSourceFile: SourceFile): boolean }).isInternalDeclaration(statement, currentSourceFile);
                    const replacement = body.statements.map((s, i) => visitStatement(s, isInternal && i !== 0));
                    if (replacement.length) {
                        return [
                            copyLeadingComments(createNotEmittedStatement(originalStatement), originalStatement.pos, currentSourceFile),
                            ...replacement,
                            copyTrailingComments(createNotEmittedStatement(originalStatement), originalStatement.end, currentSourceFile),
                        ];
                    }
                    const placeholder = createNotEmittedStatement(originalStatement);
                    copyLeadingComments(placeholder, originalStatement.pos, currentSourceFile);
                    copyTrailingComments(placeholder, originalStatement.end, currentSourceFile);
                    return placeholder;
                }
    
                return visitGlobalishStatement(statement);
            }

            function visitStatement(statement: Node, isInternal: boolean) {
                statement = visitIdentifiers(statement);
                // If the statement is an interface and that interface is an augmentation of an interface in another file
                // rewrite it into a module augmentation so that augmentation actually takes place
                if (isInterfaceDeclaration(statement)) {
                    const sym = checker.getSymbolAtLocation(getNameOfDeclaration(statement) || statement)!;
                    if (sym.declarations.length > 1 &&
                        !sym.declarations.every(d => d.getSourceFile() === sym.declarations[0].getSourceFile()) &&
                        statement !== sym.declarations[0]) {
                        const sourceMappedOriginalLocation = getSourceMapper().tryGetSourcePosition({
                            fileName: sym.declarations[0].getSourceFile().fileName,
                            pos: sym.declarations[0].pos
                        });
                        const targetFilename = sourceMappedOriginalLocation ? sourceMappedOriginalLocation.fileName : sym.declarations[0].getSourceFile().fileName;
                        statement = createModuleDeclaration(
                            /*decorators*/ undefined,
                            [createToken(SyntaxKind.DeclareKeyword)],
                            createLiteral(getTSStyleRelativePath(currentSourceFile.fileName, targetFilename.replace(/(\.d)?\.ts$/, ""))),
                            createModuleBlock([statement])
                        );
                    }
                }
                if (isInternal) {
                    setSyntheticLeadingComments(statement, [{
                        kind: SyntaxKind.MultiLineCommentTrivia,
                        pos: -1,
                        end: -1,
                        text: " @internal ",
                        hasTrailingNewLine: true
                    }]);
                }
                return statement;
            }

            function visitGlobalishStatement(statement: Node): VisitResult<Node> {
                statement = visitIdentifiers(statement);
                if (isInterfaceDeclaration(statement) || isVariableStatement(statement)) {
                    const sym = checker.getSymbolAtLocation(getNameOfDeclaration(isVariableStatement(statement) ? statement.declarationList.declarations[0] : statement) || statement)!;
                    const isMerged = sym.declarations.length > 1 && !sym.declarations.every(d => d.getSourceFile() === sym.declarations[0].getSourceFile());
                    const isAmbient = statement.modifiers && statement.modifiers.some(m => m.kind === SyntaxKind.DeclareKeyword);
                    if (isMerged || isAmbient) {
                        // Global interface/declaration - preserve globality
                        // TODO: Check if declaration is non-ambient, if so, use global augmentation to produce global value
                        // and rewrite implementation to rely on `globalThis` (if needed)
                        const isInternal = (ts as any as { isInternalDeclaration(node: Node, currentSourceFile: SourceFile): boolean }).isInternalDeclaration(statement, currentSourceFile);
                        statement = createModuleDeclaration(
                            /*decorators*/ undefined,
                            [createToken(SyntaxKind.DeclareKeyword)],
                            createIdentifier("global"),
                            createModuleBlock([stripDeclare(statement)]),
                            NodeFlags.GlobalAugmentation
                        );
                        if (isInternal) {
                            setSyntheticLeadingComments(statement, [{
                                kind: SyntaxKind.MultiLineCommentTrivia,
                                pos: -1,
                                end: -1,
                                text: " @internal ",
                                hasTrailingNewLine: true
                            }]);
                        }
                    }
                }
                return statement;
            }

            function stripDeclare<T extends Node>(statement: T): T {
                if (statement.modifiers && statement.modifiers.some(m => m.kind === SyntaxKind.DeclareKeyword)) {
                    const clone = (ts as any).getSynthesizedClone(statement);
                    clone.modifiers = clone.modifiers.filter((m: Node) => m.kind !== SyntaxKind.DeclareKeyword);
                    return setTextRange(clone, statement);
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