"use client";

import dynamic from "next/dynamic";

// next/dynamic with ssr:false is only usable from a Client Component; this
// thin wrapper lets Server Component pages (e.g. app/drives/[id]/page.tsx)
// render the map without becoming Client Components themselves.
const DriveMap = dynamic(() => import("./drive-map"), { ssr: false });

export default DriveMap;
