/* Public settings only. Everything here is visible to anyone who opens the site.
   Never put secrets in this file: the Privy app secret, the Supabase secret key, the treasury key and
   the RPC URL with its key belong in Railway → Variables (and Vercel → Environment Variables). */
window.SA_CONFIG = {
  api: "",                                    // the round server, e.g. "https://squad-arena-server.up.railway.app". Empty = the page fetches data itself.
  privyAppId: "cmvmfy22z01dx0gl2e980ir4r",
  supabaseUrl: "https://iipfuzfrwlsmxdlmjxit.supabase.co",
  supabaseKey: "sb_publishable_tnd14IH0rhKAOm5uZOpHbw_qeEgPplz"
};
