import {
    Declaration,
    getNameOfDeclaration,
    isIdentifier,
    isModuleDeclaration,
    isPropertyAccessExpression,
    isQualifiedName,
    isTypeQueryNode,
    isTypeReferenceNode,
    Node,
    NodeBuilderFlags,
    SourceFile,
    Symbol,
    SymbolFlags,
    TransformationContext,
    TypeChecker,
    visitEachChild,
    VisitResult,
    isVariableDeclaration,
    isImportTypeNode,
    visitNodes,
    updateImportTypeNode
} from "typescript";

export function getExplicitifyTransformFactoryFactory() {
    return getExplicitifyTransformFactory;
}

function getExplicitifyTransformFactory(checker: TypeChecker) {
    return explicitifyTransformFactory;
    function explicitifyTransformFactory(context: TransformationContext) {
        let sourceFile: SourceFile;
        return transformSourceFile;

        function transformSourceFile(node: SourceFile) {
            sourceFile = node;
            return visitEachChild(node, visitChildren, context);
        }

        function isSomeDeclarationInLexicalScope(sym: Symbol, location: Node) {
            return sym.declarations.every(d => { // if _any_ declaration isn't in scope, pessimistically make explicit
                // VariableDeclaration -> VariableDeclarationList -> VariableStatement -> containing declaration
                const container = isVariableDeclaration(d) ? d.parent.parent.parent : d.parent;
                let loc: Node | undefined = location;
                while (loc = loc.parent) {
                    if (loc === container) {
                        return true;
                    }
                }
                return false;
            });
        }

        function visitChildren<T extends Node>(node: T): VisitResult<T> {
            // Skip the `M` in `import("mod").M.N` - it's already fully qualified
            if (isImportTypeNode(node)) {
                const ta = visitNodes(node.typeArguments, visitChildren);
                if (node.typeArguments !== ta) {
                    return updateImportTypeNode(node, node.argument, node.qualifier, ta, node.isTypeOf) as Node as VisitResult<T>;
                }
                return node;
            }
            // We narrow the identifiers we check down to just those which aren't the name of
            // a declaration and aren't the RHS of a property access or qualified name
            if (isIdentifier(node) &&
                getNameOfDeclaration(node.parent as Declaration) !== node &&
                !(isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
                !(isQualifiedName(node.parent) && node.parent.right === node)) {
                const sym = checker.getSymbolAtLocation(node);
                const parent = sym && (sym as {parent?: Symbol}).parent;
                if (parent && parent.declarations && parent.declarations.length && parent.declarations.some(isModuleDeclaration) && !isSomeDeclarationInLexicalScope(sym!, node)) {
                    const newName = checker.symbolToEntityName(sym!, SymbolFlags.Namespace, sourceFile, NodeBuilderFlags.UseOnlyExternalAliasing);
                    if (newName && !isIdentifier(newName)) {
                        if (isQualifiedName(node.parent) || isTypeReferenceNode(node.parent) || isTypeQueryNode(node.parent)) {
                            return newName as VisitResult<Node> as VisitResult<T>;
                        }
                        return checker.symbolToExpression(sym!, SymbolFlags.Namespace, sourceFile, NodeBuilderFlags.UseOnlyExternalAliasing) as VisitResult<Node> as VisitResult<T>;
                    }
                }
            }
            return visitEachChild(node, visitChildren, context);
        }
    }
}