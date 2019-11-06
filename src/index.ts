import * as fs from "fs";
import * as path from "path";
import {
    createPrinter,
    createSolutionBuilder,
    createSolutionBuilderHost,
    isIdentifier,
    Node,
    SourceFile,
    sys,
    transform,
    TransformationContext,
    TypeChecker,
    visitEachChild,
    VisitResult,
    getNameOfDeclaration,
    Declaration,
    isPropertyAccessExpression,
    isQualifiedName,
    Identifier,
    ModuleDeclaration,
    EnumDeclaration,
    ImportEqualsDeclaration,
    FunctionLike,
    ParameterDeclaration,
    FunctionDeclaration,
    AccessorDeclaration,
    VariableLikeDeclaration,
    PropertyAccessExpression,
    SymbolFlags,
    EntityNameOrEntityNameExpression
} from "typescript";

export function transformProjectAtPath(rootConfig: string, outDir: string) {
    // We need to:
    // 1. Convert all implicit namespace member references to explicit, deep references
    //   This means converting `func()` within a namespace to an explicit `ns.func()`
    // 2. Check everything's valid - this step should be a semantic-preserving transform.
    // 3. Remove top-level namespace declarations, exporting all members
    //   Nested namespaces are tricky here, and automating their export could be hard. Today, we can mix 
    //   multiple namespace levels into one file - we can still do that, sorta, but the reexport process
    //   to retain the nested shape will be much less clean. Barring scope conflicts, this means we'll flatten all
    //   the namespaces in a file down, then tease it back apart when we recreate the namespace shape via reexports.
    //   That means we write/maintain a file that reexports all the things from all the files into the same namespace object,
    //   meaning a file with a bunch of `export * from "..."` declarations for the top-level namespace,
    //   and corresponding files for nested namespaces, with `import * as nested from "nested"; export {nested};`
    //   in the main file.
    //   Then, we go back and add imports to satisfy those namespace references (ie, `import * as ns from "../ns"`)
    //   in the original files. We should only need to add one import to each file (the root namespace).
    // 5. Ideally, check that everything is OK at this point, again, since this should also be a functioning state.
    // 6. Inline those namespace imports into individual member imports. (TBD: All from the root legacy namespace, or from
    //    the file they're originally declared in?)
    // 7. Check everything's OK one last time, and call it done.

    // This all means we'll be doing 3 seperate transforms, redoing diagnostic checks between each phase.

    const projDir = path.dirname(rootConfig);
    const host = createSolutionBuilderHost(sys);
    // we just want to (ab)use the builder API to traverse the project reference graph
    // and find all source files we need to transform, so we override the `createProgram`
    // hook to get a type checker and run our transform on each invocation
    const createProgram = host.createProgram;
    host.createProgram = (names, opts, host, oldProgram, configDiag, refs) => {
        const result = createProgram(names, opts, host, oldProgram, configDiag, refs);

        // Transform all actual input source files
        const candidateFiles = result.getSourceFiles().slice().filter(f =>
            !f.isDeclarationFile &&
            !f.fileName.endsWith(".json") &&
            !f.fileName.endsWith(".js") &&
            !f.fileName.endsWith(".jsx")
        );
        const checker = result.getProgram().getTypeChecker();
        const newSources = transform(candidateFiles, [getExplicitifyTransformFactory(checker)]);
        const printer = createPrinter({}, {
            onEmitNode: newSources.emitNodeWithNotification,
            substituteNode: newSources.substituteNode
        });
        for (const file of newSources.transformed) {
            const fullPath = path.resolve(file.fileName); // assumes file.fileName is absolute - in certain (?) scenarios this may not be the case
            const fragment = path.relative(path.resolve(projDir), fullPath);
            const newPath = path.join(path.resolve(outDir), fragment);
            try {
                fs.mkdirSync(path.dirname(newPath), { recursive: true });
            }
            catch {}
            fs.writeFileSync(newPath, printer.printFile(file));
        }

        return result;
    };
    
    const solution = createSolutionBuilder(host, [rootConfig], {});
    solution.clean(); // we _do_ need to clean to get a good build, though

    // Building will now trigger phase 1 - making every namespace member reference explicit
    solution.build();
    return;

    function getExplicitifyTransformFactory(checker: TypeChecker) {
        return explicitifyTransformFactory;
        function explicitifyTransformFactory(context: TransformationContext) {
            const resolver = (context as ExposeInternalsOfTransformationContext).getEmitResolver();
            return transformSourceFile;

            function transformSourceFile(node: SourceFile) {
                return visitEachChild(node, visitChildren, context);
            }

            function visitChildren<T extends Node>(node: T): VisitResult<T> {
                // We narrow the identifiers we check down to just those which aren't the name of
                // a declaration and aren't the RHS of a property access or qualified name
                if (isIdentifier(node) &&
                    getNameOfDeclaration(node.parent as Declaration) !== node &&
                    !(isPropertyAccessExpression(node.parent) && node.parent.name === node) &&
                    !(isQualifiedName(node.parent) && node.parent.right === node)) {

                    checker.getTypeAtLocation(node).symbol
                }
                return visitEachChild(node, visitChildren, context);
            }
        }
    }
}

interface ExposeInternalsOfTransformationContext extends TransformationContext {
    /*@internal*/ getEmitResolver(): InternalEmitResolver;
}

interface InternalEmitResolver {
    isSymbolAccessible(symbol: Symbol, enclosingDeclaration: Node | undefined, meaning: SymbolFlags | undefined, shouldComputeAliasToMarkVisible: boolean): InternalSymbolVisibilityResult;
    isEntityNameVisible(entityName: EntityNameOrEntityNameExpression, enclosingDeclaration: Node): InternalSymbolVisibilityResult;
}

interface InternalSymbolVisibilityResult {
    accessible: number;
}
