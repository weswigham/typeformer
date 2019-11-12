import { TypeChecker, TransformationContext, SourceFile, isImportDeclaration, isNamespaceImport, ImportDeclaration, ImportClause, NamespaceImport, visitNodes, updateSourceFileNode, Node, VisitResult, visitEachChild, isQualifiedName, isPropertyAccessExpression, isIdentifier, SymbolFlags, idText } from "typescript";

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
            const imports = file.statements.filter(s =>
                isImportDeclaration(s) &&
                !!s.importClause &&
                !!s.importClause.namedBindings &&
                isNamespaceImport(s.importClause.namedBindings)
            ) as (ImportDeclaration & { importClause: ImportClause & { namedBindings: NamespaceImport } })[];
            const statements = visitNodes(file.statements, visitIdentifiers);
            return updateSourceFileNode(file, [...statements]);

            function visitIdentifiers(node: Node): VisitResult<Node> {
                if (isImportDeclaration(node)) {
                    return node;
                }
                if (isQualifiedName(node) && isIdentifier(node.left)) {
                    const s = checker.getSymbolAtLocation(node.left);
                    const rhsName = idText(node.right);
                    // This is very TS-specific, but we exclude globals from the lookup if we're resolving `Symbol` or `Node`
                    // so we exclude the global `Symbol` and `Node` - we don't use them, and always expect our own local
                    // `Symbol` and `Node`, instead. We want to be capable of inlining them we they don't force us to keep
                    // `ts.Symbol` and the `import * as ts` import around.
                    const shouldExcludeGlobals = rhsName === "Symbol" || rhsName === "Node";
                    const bareName = checker.resolveName(rhsName, node, SymbolFlags.Type | SymbolFlags.Namespace, shouldExcludeGlobals);
                    if (!bareName) {
                        // Only attempt to inline ns if the thing we're inlining to doesn't currently resolve (globals are OK, we'll over)
                    }
                }
                if (isPropertyAccessExpression(node) && isIdentifier(node.expression)) { // technically should handle parenthesis, casts, etc - maybe not needed, though

                }
                return visitEachChild(node, visitIdentifiers, context);
            }
        }
    }
}