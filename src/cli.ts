#!/usr/bin/env node
import { transformProjectInPlace } from ".";
import { existsSync } from "fs";
import { resolve } from "path";

const fileName = process.argv[1];
if (!fileName || !existsSync(fileName)) {
    console.error(`File ${fileName} not found - provide a path to the root project tsconfig.`);
}
transformProjectInPlace(resolve(process.cwd(), fileName));