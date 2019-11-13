import { TypeChecker, Symbol, TransformationContext, SourceFile, isImportDeclaration, isNamespaceImport, ImportDeclaration, ImportClause, NamespaceImport, visitNodes, updateSourceFileNode, Node, VisitResult, visitEachChild, isQualifiedName, isPropertyAccessExpression, isIdentifier, SymbolFlags, idText, StringLiteral, Identifier, createImportDeclaration, createImportClause, createNamedImports, createLiteral, createImportSpecifier, createIdentifier } from "typescript";
import { getNamespaceImports, removeUnusedNamespaceImports } from "./removeUnusedNamespaceImports";

export function getInlineImportsTransformFactoryFactory() {
    return getInlineImportsTransformFactory;
}

interface InternalChecker extends TypeChecker {
    /* @internal */ resolveName(name: string, location: Node, meaning: SymbolFlags, excludeGlobals: boolean): Symbol | undefined;
}

function getInlineImportsTransformFactory(rawChecker: TypeChecker) {
    const checker = rawChecker as InternalChecker;
    return inlineImports;
    function inlineImports(context: TransformationContext) {
        return transformSourceFile;
        function transformSourceFile(file: SourceFile) {
            const imports = getNamespaceImports(file.statements);
            const syntheticImports = new Map<string, Set<string>>();
            const statements = visitNodes(file.statements, visitIdentifiers);
            const newImportStatements: ImportDeclaration[] = [];
            syntheticImports.forEach((importNames, specifier) => {
                newImportStatements.push(createImportDeclaration(
                    /*decorators*/ undefined,
                    /*modifiers*/ undefined,
                    createImportClause(/*defaultName*/ undefined, createNamedImports(Array.from(importNames.values()).map(s => createImportSpecifier(/*propertyName*/ undefined, createIdentifier(s))))),
                    createLiteral(specifier)
                ));
            });
            return updateSourceFileNode(file, removeUnusedNamespaceImports([...newImportStatements, ...statements]));

            function visitIdentifiers(node: Node): VisitResult<Node> {
                if (isImportDeclaration(node)) {
                    return node;
                }
                let s: Symbol | undefined;
                let rhsName: string | undefined;
                let possibleSubstitute: Identifier | undefined;
                if (isQualifiedName(node) && isIdentifier(node.left)) {
                    s = checker.getSymbolAtLocation(node.left);
                    rhsName = idText(node.right);
                    possibleSubstitute = node.right;
                }
                if (isPropertyAccessExpression(node) && isIdentifier(node.expression)) { // technically should handle parenthesis, casts, etc - maybe not needed, though
                    s = checker.getSymbolAtLocation(node.expression);
                    rhsName = idText(node.name);
                    possibleSubstitute = node.name;
                }
                if (s && rhsName && possibleSubstitute) {
                    // This is very TS-specific, but we exclude globals from the lookup if we're resolving `Symbol` or `Node`
                    // so we exclude the global `Symbol` and `Node` - we don't use them, and always expect our own local
                    // `Symbol` and `Node`, instead. We want to be capable of inlining them we they don't force us to keep
                    // `ts.Symbol` and the `import * as ts` import around.
                    const shouldExcludeGlobals = rhsName === "Symbol" || rhsName === "Node";
                    const bareName = checker.resolveName(rhsName, node, SymbolFlags.Type | SymbolFlags.Namespace, shouldExcludeGlobals);
                    if (!bareName) {
                        // Only attempt to inline ns if the thing we're inlining to doesn't currently resolve (globals are OK, we'll over)
                        const matchingImport = imports.find(i => checker.getSymbolAtLocation(i.importClause.namedBindings.name) === s);
                        if (matchingImport) {
                            addSyntheticImport((matchingImport.moduleSpecifier as StringLiteral).text, rhsName);
                            return possibleSubstitute;
                        }
                    }
                }
                return visitEachChild(node, visitIdentifiers, context);
            }

            function addSyntheticImport(specifier: string, importName: string) {
                const synthMap = syntheticImports.get(specifier) || new Set();
                syntheticImports.set(specifier, synthMap);
                synthMap.add(importName);
            }
        }
    }
}