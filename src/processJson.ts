import * as bb from "bluebird";
import { Compilation } from "webpack";
import { fromPairs, clone, keys } from "lodash";
import { join } from "path";
import { readFileAsync } from "./util";
import { FilesByType, Assets, ProcessContext } from "./option";

export async function processJson(context: ProcessContext, files: [FilesByType, Assets]): bb<[FilesByType, Assets]> {
    const [toCopy, assets] = files;
    const jsonFiles = toCopy["json"];
    delete toCopy["json"];
    delete assets["json"];
    const others = clone(files);
    const data = await bb.map(
        keys(jsonFiles),
        filename => readFileAsync(join(context.context, jsonFiles[filename].srcFile)).then(
            buf => buf.toString("utf-8")
        ).then<[string, any]>(
            data => [filename, JSON.parse(data)]
        )
    );
    const merged = await fromPairs(data);
    assets["mergedjson"] = {
        "data.json": {
            ext: ".json",
            name: "data.json",
            outFile: "data.json",
            srcFile: ""
        }
    };
    const stringified = JSON.stringify(merged);
    context.compilation.assets["data.json"] = {
        size: () => stringified.length,
        source: () => stringified
    };

    return [toCopy, assets];
}
