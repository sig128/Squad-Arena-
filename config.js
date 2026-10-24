/* Public settings only. Everything here is visible to anyone who opens the site.
   Never put secrets in this file: the Privy app secret, the Supabase secret key, the treasury key and
   the RPC URL with its key belong in Railway → Variables (and Vercel → Environment Variables). */
window.SA_CONFIG = {
  api: "https://squad-arena-production.up.railway.app",   // the round server. Empty = the page fetches data itself.
  treasury: "7ah1hkAhjnfp62jxFx1E3Ki5fLKr57RY964XdLWi9dRt", // the arena wallet. The site only signs deposits to this address.
  privyAppId: "cmvmfy22z01dx0gl2e980ir4r",
  supabaseUrl: "https://iipfuzfrwlsmxdlmjxit.supabase.co",
  supabaseKey: "sb_publishable_tnd14IH0rhKAOm5uZOpHbw_qeEgPplz"
};
