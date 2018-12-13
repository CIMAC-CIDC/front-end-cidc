// import currentUrl from "../initialize";
import { UriOptions } from "request";
import * as request from "request-promise-native";

interface IAPIHelperOptions {
    endpoint: string;
    etag?: string;
    itemID?: string;
    token?: string;
    parameters?: { [key: string]: string };
    body?: { [key: string]: string };
}

interface IAPIHelper {
    baseURL: string;
    delete<T>(opts: IAPIHelperOptions): Promise<T | undefined>;
    get<T>(opts: IAPIHelperOptions): Promise<T | undefined>;
    patch<T>(opts: IAPIHelperOptions): Promise<T | undefined>;
    post<T>(opts: IAPIHelperOptions): Promise<T | undefined>;
}

/**
 * Async implementation of basic HTTP type requests.
 * @param options Standard HTTP request type options.
 */
async function makeRequest<T>(
    options: UriOptions & request.RequestPromiseOptions
): Promise<T | undefined> {
    return await request(options);
}

const generateOptions = (
    opts: IAPIHelperOptions,
    method: string,
    baseURL: string
) => {
    return {
        body: opts.body,
        headers: {
            Authorization: `Bearer ${opts.token}`
        },
        json: true,
        method,
        qs: opts.parameters,
        uri: `${baseURL}/${opts.endpoint}${
            opts.itemID ? `/${opts.itemID}` : ""
        }`
    };
};

/**
 * Factory function menat to emulate my SmartFetch class in python.
 * @param baseURL pass an object of the type { baseURL: your-url-here }
 */
const createAPIHelper = ({ baseURL }: { baseURL: string }): IAPIHelper => {
    const get = <T>(opts: IAPIHelperOptions): Promise<T | undefined> => {
        return makeRequest<T | undefined>(
            generateOptions(opts, "GET", baseURL)
        );
    };
    const patch = <T>(opts: IAPIHelperOptions): Promise<T | undefined> => {
        const optid = generateOptions(opts, "POST", baseURL);
        optid.headers["X-HTTP-METHOD-OVERRIDE"] = "PATCH";
        if (opts.etag) {
            optid.headers["If-Match"] = opts.etag;
        }
        return makeRequest<T | undefined>(optid);
    };
    const post = <T>(opts: IAPIHelperOptions): Promise<T | undefined> => {
        return makeRequest<T | undefined>(
            generateOptions(opts, "POST", baseURL)
        );
    };
    const delF = <T>(opts: IAPIHelperOptions): Promise<T | undefined> => {
        return makeRequest<T | undefined>(
            generateOptions(opts, "DELETE", baseURL)
        );
    };
    return Object.freeze({
        baseURL,
        delete: delF,
        get,
        patch,
        post
    });
};

export {
    createAPIHelper,
    generateOptions,
    IAPIHelper,
    IAPIHelperOptions,
    makeRequest
};
