import * as wp from 'webpack';

declare interface LoaderContext {
    _compilation: wp.Compilation,
    _compiler: wp.Compiler,
    _module: wp.Module,
    cacheable: (a?: boolean) => void;
    async: () => (e: Error, content: string) => void;
    addDependency: (file: string) => void;
    resourcePath: string;
}

declare function getOptions(context: LoaderContext): {[key: string]: string};