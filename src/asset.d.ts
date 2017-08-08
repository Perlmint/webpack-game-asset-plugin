declare module "game-asset!*" {
    const assetID: string;
    export const path: string;
    export default assetID;
}
declare module "game-asset?*" {
    const assetID: string;
    export const path: string;
    export default assetID;
}