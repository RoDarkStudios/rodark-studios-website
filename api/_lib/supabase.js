const DEFAULT_SUPABASE_URL = 'https://nerncnuyubgnfsrimmei.supabase.co';

function getSupabaseConfig() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        || process.env.SUPABASE_PUBLISHABLE_KEY;

    if (!url || !anonKey) {
        const missing = [];
        if (!url) {
            missing.push('SUPABASE_URL');
        }
        if (!anonKey) {
            missing.push('SUPABASE_ANON_KEY');
        }
        throw new Error(`${missing.join(' and ')} must be set`);
    }

    return { url, anonKey };
}

async function supabaseAuthRequest(path, options = {}) {
    const { url, anonKey } = getSupabaseConfig();
    const response = await fetch(`${url}${path}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${options.token || anonKey}`,
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = { raw: text };
        }
    }

    return { response, data };
}

async function supabaseRestRequest(path, options = {}) {
    const { url, anonKey } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1${path}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${options.token}`,
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await response.text();
    let data = {};

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            data = { raw: text };
        }
    }

    return { response, data };
}

module.exports = {
    supabaseAuthRequest,
    supabaseRestRequest
};
