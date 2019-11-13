import { Statement, isImportDeclaration, isNamespaceImport, ImportDeclaration, ImportClause, NamespaceImport, idText, forEachChild, isIdentifier, Node, isQualifiedName, isPropertyAccessExpression } from "typescript";

export function removeUnusedNamespaceImports(statements: readonly Statement[]) {
    const imports = getNamespaceImports(statements);
    if (!imports.length) {
        return statements.slice();
    }
    const unusedImports = imports.filter(i => {
        const name = idText(i.importClause.namedBindings.name);
        return !statements.some(s => s !== i && forEachChild(s, containsReferenceTo(name)));
    });
    return statements.filter(s => !unusedImports.find(elem => elem === s));
}

function containsReferenceTo(name: string) {
    return checkNode;
    function checkNode(n: Node): true | undefined {
        if (isIdentifier(n) && idText(n) === name && !(n.parent && isQualifiedName(n.parent) && n.parent.right === n) && !(n.parent && isPropertyAccessExpression(n.parent) && n.parent.name === n)) {
            return true;
        }
        return forEachChild(n, checkNode);
    }
}

export function getNamespaceImports(statements: readonly Statement[]) {
    return statements.filter(s =>
        isImportDeclaration(s) &&
        !!s.importClause &&
        !!s.importClause.namedBindings &&
        isNamespaceImport(s.importClause.namedBindings)
    ) as (ImportDeclaration & { importClause: ImportClause & { namedBindings: NamespaceImport } })[];
}