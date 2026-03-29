import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieRow = { name: string; value: string; options: CookieOptions };

/** Server Components / Route Handlers — 세션 쿠키 동기화 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieRow[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }: CookieRow) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /* Server Component 등에서 set 불가 시 무시 */
          }
        },
      },
    }
  );
}
