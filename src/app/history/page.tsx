import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/layout/header";

export const metadata: Metadata = {
  title: "History of the Hill | Breadloaf Hill",
  description: "The family’s vision for Breadloaf Hill and the records of its beginnings.",
};

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
          <p>The family’s inheritance history also quotes a May 1981 letter from Lois describing a provision giving Middlebury the first opportunity to purchase the property if it were sold.</p>
        </section>

        <section aria-labelledby="history-sources" className="history-sources">
          <h2 id="history-sources">Sources</h2>
          <p>The recorded deeds and the family’s own account of its purpose:</p>
          <ul>
            <li><a href="https://ripton.lr-1.com/" target="_blank" rel="noopener noreferrer">Ripton land records: Book 16, pp. 362–363 and 370; Book 21, pp. 397–399</a></li>
            <li><Link href="/documents/cmrgfq72e0029p545f8py4en0">The vision for Breadloaf Hill</Link></li>
            <li><Link href="/documents/cmrgfq78n002dp545cn591tc8">Inheritance history, 2013</Link></li>
            <li><Link href="/documents/cmrgfq7f3002gp545pcx1drkq">Corporation bylaws</Link></li>
          </ul>
        </section>
      </article>
    </div>
  );
}
