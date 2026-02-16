import "axios";

declare module "axios" {
  export interface InternalAxiosRequestConfig {
    /** Set by the 401 response interceptor to prevent infinite retry loops. */
    _retried?: boolean;
  }
}
