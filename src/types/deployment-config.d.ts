declare module '../deployment.config.mjs' {
  export const deploymentConfig: {
    frontendHost: string;
    frontendPort: number;
    backendBaseUrl: string;
    ollamaBaseUrl: string;
    ollamaModel: string;
    difyBaseUrl: string;
  };
}

declare module './deployment.config.mjs' {
  export const deploymentConfig: {
    frontendHost: string;
    frontendPort: number;
    backendBaseUrl: string;
    ollamaBaseUrl: string;
    ollamaModel: string;
    difyBaseUrl: string;
  };
}
