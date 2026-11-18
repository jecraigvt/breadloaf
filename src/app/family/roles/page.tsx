import Link from "next/link";
import { z } from "zod";
import { Header } from "@/components/layout/header";

// The notice is private runtime configuration on the web service. Keep it out
// of public source, static builds, and client components.
export const dynamic = "force-dynamic";

const roleNotice = z.object({
  source: z.string().min(1),
  roles: z.array(z.object({
    title: z.string().min(1),
    name: z.string().min(1),
    duties: z.array(z.string().min(1)).min(1),
    limit: z.string().optional(),
  })).min(1),
});

function readRoleNotice() {
  try {
    return roleNotice.parse(JSON.parse(process.env.FAMILY_ROLE_NOTICE_JSON ?? "null"));
  } catch {
    return null;
  }
}

export default function CorporationRolesPage() {
  const notice = readRoleNotice();
  return (
    <div>
      <Header title="Corporation roles" subtitle="Who handles the property, finances, records and website." />
      <div className="mx-auto max-w-5xl px-5 pb-12">
        <Link href="/family" className="fg-archive-text-link">Back to the family</Link>
        {notice ? (
          <>
            <p className="my-5 max-w-prose leading-relaxed">{notice.source}</p>
            <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
              {notice.roles.map(({ title, name, duties, limit }) => (
                <section key={title} className="border-t border-[var(--muted)] pt-4">
                  <h2 className="font-[family-name:var(--serif)] text-3xl">{title}</h2>
                  <p className="my-2 font-semibold">{name}</p>
                  <ul className="list-disc space-y-2 pl-5 leading-relaxed">
                    {duties.map((duty) => <li key={duty}>{duty}</li>)}
                  </ul>
                  {limit && <p className="mt-3 border-l-2 border-[var(--pine)] pl-3 font-medium">{limit}</p>}
                </section>
              ))}
            </div>
          </>
        ) : <p className="my-5">The Corporation’s role notice is currently unavailable.</p>}
        <nav aria-label="Corporate records" className="mt-8 flex flex-wrap gap-x-6 border-t border-[var(--muted)]">
          <Link href="/upload" className="fg-archive-text-link">Upload a family scan</Link>
          <Link href="/documents" className="fg-archive-text-link">Browse the document archive</Link>
        </nav>
      </div>
    </div>
  );
}
