import dns from "node:dns";

/**
 * WHY THIS FILE EXISTS
 *
 * MongoDB Atlas connection strings look like mongodb+srv://... The "+srv"
 * variant needs a special DNS SRV lookup to find the cluster's servers.
 * Some networks (campus firewalls, VPN/proxy tools, ad-blockers) run a local
 * DNS resolver on 127.0.0.1 that refuses SRV queries. The symptom is:
 *
 *   querySrv ECONNREFUSED _mongodb._tcp.<cluster-host>
 *
 * and the bot logs "the database is not connected" even though the URI,
 * username and password are all correct.
 *
 * THE FIX: point this Node process at public resolvers (Cloudflare + Google).
 * dns.setServers() changes DNS only for OUR process — Windows settings,
 * other apps and the network are untouched. It runs once at startup.
 */
export function usePublicDnsFallback() {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
  console.log("[dns] Using public DNS resolvers (1.1.1.1, 8.8.8.8) for this process");
}
