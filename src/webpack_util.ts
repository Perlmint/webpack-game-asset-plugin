import * as wp from "webpack";

export namespace wp_internal {
    export type WebpackError = typeof wp.Compilation.prototype.warnings[0];
    export type SourcePosition = Extract<WebpackError['loc'], { start: Object }>['start'];
}

export class PluginWarning<D> extends Error implements wp_internal.WebpackError {
    loc: any;
    hideStack = false;
    file: string;
    chunk!: wp.Chunk;

    constructor(public module: wp.NormalModule, message: string, public details: D) {
        super(message);

        this.file = module.resource;
    }

    serialize(__0: { write: any }): void {

    }
	deserialize(__0: { read: any }): void {

    }
}

export function markModuleAsAsset(module: wp.Module) {
    (module as any).__is_asset__ = true;
}

export function isAssetModule(module: wp.Module): module is wp.NormalModule {
    return (module as any).__is_asset__ === true;
}

export function isJavascriptModule(module: wp.Module): module is wp.NormalModule {
    return module.type.startsWith('javascript/');
}
