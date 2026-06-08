declare const brand: unique symbol;
export type Brand<T, B> = T & { readonly [brand]: B };

export type ProfileId = Brand<string, "ProfileId">;
export type JobId = Brand<string, "JobId">;
export type CvId = Brand<string, "CvId">;
