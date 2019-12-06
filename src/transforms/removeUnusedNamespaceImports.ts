import { Statement, isImportDeclaration, isNamespaceImport, ImportDeclaration, ImportClause, NamespaceImport, idText, forEachChild, isIdentifier, Node, isQualifiedName, isPropertyAccessExpression, getNameOfDeclaration, Declaration, isExportDeclaration, isNamedExports, isExportSpecifier, isBlock, isVariableStatement, isModuleBlock, isConstructorDeclaration, isFunctionDeclaration, isArrowFunction, BindingName, isOmittedExpression } from "typescript";

/**
 * Heuristically removes unused namespace imports if they obviously have no references left
 * This is not semantic - it just scans the AST for an appropriate identifier that may or
 * may not refer to the namespace import; so this can be easily fooled by variable shadowing.
 * @param statements 
 */
export function removeUnusedNamespaceImports(statements: readonly Statement[], debug?: boolean) {
    const imports = getNamespaceImports(statements);
    if (!imports.length) {
        return statements.slice();
    }
    const unusedImports = imports.filter(i => {
        const name = idText(i.importClause.namedBindings.name);
        return !statements.some(s => s !== i && containsReferenceTo(name, !!debug)(s));
    });
    return statements.filter(s => !unusedImports.find(elem => elem === s));
}

function bindingContainsName(binding: BindingName, name: string): boolean {
    if (isIdentifier(binding)) {
        return name === idText(binding);
    }
    return binding.elements.some(elem => !isOmittedExpression(elem) && bindingContainsName(elem.name, name));
}

function containsReferenceTo(name: string, debug: boolean) {
    return checkNode;
    function checkNode(n: Node): true | undefined {
        if (isQualifiedName(n)) {
            return checkNode(n.left); // Only check LHS of qualified names
        }
        if (isPropertyAccessExpression(n)) {
            return checkNode(n.expression); // same for property accesses
        }
        if (isIdentifier(n) && idText(n) === name &&
            !(n.parent && !isExportSpecifier(n.parent) && getNameOfDeclaration(n.parent as Declaration) === n) // parent points are unreliable unless we're asking about the "original meaning" of the thing
        ) {
            if (name === "documents" && debug) {
                debugger;
            }
            return true;
        }
        if (isBlock(n) || isModuleBlock(n)) {
            // If a block contains a variable declaration of the name we're looking for, do not descend into that block -
            // that declaration shadows the import
            if (n.statements.some(s => isVariableStatement(s) && s.declarationList.declarations.some(d => bindingContainsName(d.name, name)))) {
                return;
            }
        }
        if (isConstructorDeclaration(n) || isFunctionDeclaration(n) || isArrowFunction(n)) {
            // Likewise, if a function parm is named the same, it shadows the name within that scope
            if (n.parameters.some(p => bindingContainsName(p.name, name))) {
                return;
            }
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