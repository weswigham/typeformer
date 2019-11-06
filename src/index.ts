import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";

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
    const host = ts.createSolutionBuilderHost(ts.sys);
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
        const newSources = ts.transform(candidateFiles, [transformFactoryFactory(checker)]);
        const printer = ts.createPrinter({}, {
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
    

    const solution = ts.createSolutionBuilder(host, [rootConfig], {});
    solution.clean(); // we _do_ need to clean to get a good build, though
    solution.build();
    return;

    function transformFactoryFactory(checker: ts.TypeChecker) {
        return transformFactory;
        function transformFactory(context: ts.TransformationContext) {
            return transform;

            function transform(node: ts.SourceFile) {
                return node;
            }
        }
    }
}
