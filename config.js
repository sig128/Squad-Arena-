/* Public settings only. Everything here is visible to anyone who opens the site.
   Never put secrets in this file: the Privy app secret, the Supabase secret key and the
   RPC URL with its key belong in Vercel → Settings → Environment Variables. */
window.SA_CONFIG = {
  rpc: "",                                   // leave empty in the repo; the RPC stream will run server-side
  privyAppId: "cmvmfy22z01dx0gl2e980ir4r",
  supabaseUrl: "https://iipfuzfrwlsmxdlmjxit.supabase.co",
  supabaseKey: "sb_publishable_tnd14IH0rhKAOm5uZOpHbw_qeEgPplz"
};
