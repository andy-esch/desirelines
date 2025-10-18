/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly REACT_APP_API_URL?: string;
  // Add more env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
