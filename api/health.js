module.exports = (req, res) => {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const hasSupabaseUrlEnv = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const supabaseUrlSet = hasSupabaseUrlEnv;
    const supabaseAnonSet = Boolean(
        process.env.SUPABASE_ANON_KEY
        || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        || process.env.SUPABASE_PUBLISHABLE_KEY
    );

    return res.status(200).json({
        ok: true,
        service: 'rodark-studios-website',
        environment: process.env.VERCEL_ENV || 'local',
        env: {
            supabaseUrlSet,
            supabaseAnonSet,
            usingSupabaseUrlFallback: !hasSupabaseUrlEnv
        },
        timestamp: new Date().toISOString()
    });
};
