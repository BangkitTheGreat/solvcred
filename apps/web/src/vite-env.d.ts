/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLVCRED_PROGRAM_ID?: string;
  readonly VITE_SOLVCRED_RPC_URL?: string;
  readonly VITE_SOLVCRED_GENESIS_HASH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
