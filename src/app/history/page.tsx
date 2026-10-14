import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";

export const metadata: Metadata = {
  title: "History of the Hill | Breadloaf Hill",
  description: "The family’s vision for Breadloaf Hill and the records of its beginnings.",
};

const FAMILY_ORIGINALS = [
  { id: "cmrgfq72e0029p545f8py4en0", title: "The vision for Breadloaf Hill", description: "The family’s account of Bill and Lois’s purpose for the cabin, and the principles of shared care." },
  { id: "cmrgfq78n002dp545cn591tc8", title: "Inheritance history, 2013", description: "Quotes Lois’s May 1981 letter and traces later changes to the family’s governance. The standalone 1981 letter is not currently in the archive." },
  { id: "cmrgfq6pw0024p5458jvxs9t4", title: "Instruction letter to the brothers", description: "Headed April 2011, with an April 2012 update. Brings together earlier minutes and correspondence about running the property." },
  { id: "cmrgfq7f3002gp545pcx1drkq", title: "Corporation bylaws", description: "The rules for the family’s shared ownership, representation, and use of the property." },
];

export default function HistoryPage() {
  return (
    <div className="fade-in history-page">
      <Header title="History of the hill" subtitle="A place to gather, and a responsibility to share." />
      <article className="history-article">
        <section aria-labelledby="history-vision">
          <div className="section-head fg-section-head"><h2 id="history-vision" className="lt">A place for <em>family</em></h2></div>
          <p>Bill and Lois Craig intended Breadloaf Hill to be a permanent gathering place for the family: summers together, reunions, and especially blueberry season.</p>
          <p>As the family grew and the facilities aged, their four sons renewed that vision. The aim remained the same: keep a place where the family could come together, with its care shared equally among the four branches.</p>
        </section>

        <section aria-labelledby="history-records">
          <div className="section-head fg-section-head"><h2 id="history-records" className="lt">The land, <em>1964</em></h2></div>
          <p>A warranty deed dated July 6, 1964 records William Gregory and Lois Bestor Craig acquiring the 15.082-acre tract from William Hazlett and Marjory Wright Upson. It was recorded in Ripton the next day, in Book 16, page 370.</p>
          <p>Bill and Lois later conveyed the same tract to Breadloaf Hill Inc. in a deed dated October 16, 1979, recorded November 6 in Book 21, pages 397–399. The family’s acquisition and the transfer to the corporation were separate events; neither establishes when the house was built.</p>
        </section>

        <section aria-labelledby="history-middlebury">
          <div className="section-head fg-section-head"><h2 id="history-middlebury" className="lt">The Middlebury <em>connection</em></h2></div>
          <p>Two earlier deeds between the Upsons and Middlebury College, dated June 2, 1964, clarified the boundary between their properties. The College’s deed states that purpose explicitly. The later deed to Bill and Lois came from the Upsons; these records do not establish a direct gift from the College to the Craig family.</p>
          <p>The family’s inheritance history also quotes a May 1981 letter from Lois describing a provision giving Middlebury the first opportunity to purchase the property if it were sold. <Link href="/documents/cmrgfq78n002dp545cn591tc8/read">Read the quoted letter.</Link></p>
        </section>

        <section aria-labelledby="history-sources" className="history-sources">
          <h2 id="history-sources">Read the original documents</h2>
          <p>Open the text here, or download the original Word file:</p>
          <div className="history-originals">
            {FAMILY_ORIGINALS.map(source => <article key={source.id} className="history-original">
              <h3>{source.title}</h3>
              <p>{source.description}</p>
              <div className="history-original-actions">
                <Link href={`/documents/${source.id}/read`} aria-label={`Read ${source.title}`}>Read document →</Link>
                <a href={`/api/documents/${source.id}/file?download=1`} aria-label={`Download ${source.title} as a Word file`}>Download Word file</a>
              </div>
            </article>)}
          </div>
          <h3 className="history-deeds-title">Recorded deeds</h3>
          <p><a href="https://ripton.lr-1.com/" target="_blank" rel="noopener noreferrer">Open Ripton’s land records ↗</a><br />1964 acquisition: Book 16, page 370. Earlier boundary deeds: Book 16, pages 362–363. 1979 transfer: Book 21, pages 397–399.</p>
        </section>
      </article>
    </div>
  );
}
