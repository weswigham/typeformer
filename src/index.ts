import * as fs from "fs";
import * as path from "path";
import {
    createPrinter,
    createSolutionBuilder,
    createSolutionBuilderHost,
    Diagnostic,
    formatDiagnostic,
    SourceFile,
    sys,
    transform,
    TransformerFactory,
    TypeChecker
} from "typescript";
import { getExplicitifyTransformFactory } from "./transforms/explicitify";
import { getStripNamespacesTransformFactory } from "./transforms/stripNamespaces";
import { getInlineImportsTransformFactory } from "./transforms/inlineImports";

/**
 * Loads a project up and executes the given transformer on all programs within the project
 * @param rootConfig The path to the root tsconfig with references to all projects
 * @param outDir The output directory to collect the transformed files and config files in (set to `dirname(rootConfig)` to overwrite input)
 * @param getTransformerFactory The factory to produce the transformer to execute
 */
export function transformProject(rootConfig: string, outDir: string, getTransformerFactory: (checker: TypeChecker) => TransformerFactory<SourceFile>) {
    const projDir = path.dirname(rootConfig);
    const host = createSolutionBuilderHost(sys);
    const allConfigFiles = new Set<string>([rootConfig]);
    // we just want to (ab)use the builder API to traverse the project reference graph
    // and find all source files we need to transform, so we override the `createProgram`
    // hook to get a type checker and run our transform on each invocation
    const createProgram = host.createProgram;
    host.createProgram = (names, opts, host, oldProgram, configDiag, refs) => {
        const result = createProgram(names, opts, host, oldProgram, configDiag, refs);
        [(opts as {configFilePath?: string}).configFilePath!, ...(opts as {configFile?: { extendedSourceFiles?: string[] }}).configFile!.extendedSourceFiles!].forEach(f => f && allConfigFiles.add(f));
        // Transform all actual input source files
        const candidateFiles = result.getSourceFiles().slice().filter(f =>
            !f.isDeclarationFile &&
            !f.fileName.endsWith(".json") &&
            !f.fileName.endsWith(".js") &&
            !f.fileName.endsWith(".jsx")
        );
        const checker = result.getProgram().getTypeChecker();
        const newSources = transform(candidateFiles, [getTransformerFactory(checker)]);
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

    // Copy config files to output
    allConfigFiles.forEach(f => {
        const fragment = path.relative(path.resolve(projDir), f);
        const outPath = path.join(path.resolve(outDir), fragment);
        try {
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
        }
        catch {}
        fs.writeFileSync(outPath, fs.readFileSync(f));
    });

    const diagnostics: Diagnostic[] = [];
    const checkHost = createSolutionBuilderHost(sys, /*createProgram*/ undefined, diag => {
        diagnostics.push(diag);
    });
    const resultSolution = createSolutionBuilder(checkHost, [path.join(path.resolve(outDir), path.relative(path.resolve(projDir), rootConfig))], {});
    resultSolution.build();
    if (diagnostics.length > 0) {
        const formatHost = {
            getCanonicalFileName(s: string) { return s; },
            getNewLine() { return "\n"; },
            getCurrentDirectory() { return projDir; }
        }
        throw new Error(`Diagnostics reported!:
        
        ${diagnostics.map(d => formatDiagnostic(d, formatHost)).join("\n")}`);
    }
    resultSolution.clean();
    return;
}

export function transformProjectFromNamespacesToModules(rootConfig: string, outDir: string) {
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

    // 1. Make all namespace references explicit and recheck
    transformProject(rootConfig, outDir+"_stage1", getExplicitifyTransformFactory);
    // 2. Strip all namespace declarations, ensure `export` modifiers are present, collect reexport files
    //   and add namespace imports
    transformProject(outDir+"_stage1/tsconfig.json", outDir+"_stage2", getStripNamespacesTransformFactory);
    // 3. Inline Imports
    transformProject(outDir+"_stage2/tsconfig.json", outDir, getInlineImportsTransformFactory);
}
