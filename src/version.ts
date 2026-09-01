declare const __APP_VERSION__: string
declare const __APP_COMMIT__: string
declare const __APP_BUILT__: string

/** Подставляются при сборке, см. `define` в vite.config.ts. */
export const VERSION = __APP_VERSION__
export const COMMIT = __APP_COMMIT__
export const BUILT_AT = __APP_BUILT__
