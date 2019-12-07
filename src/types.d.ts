declare module "merge-dirs" {
    export default function mergeDirs(inputPath: string, outputPath: string, conflict?: "overwrite" | "ask" | "skip"): void;
}