import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  Mountain,
  Camera,
  MessageCircle,
  FolderOpen,
  Megaphone,
  ArrowRight,
  FileText,
  Tag,
  Calendar,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [docCount, recentDocs, categories, bulletinMessages] =
    await Promise.all([
      prisma.document.count(),
      prisma.document.findMany({
        include: { category: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      prisma.category.findMany({
        include: { _count: { select: { documents: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.bulletinMessage.findMany({
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        take: 3,
      }),
    ]);

  const categoriesWithDocs = categories.filter(
    (c) => c._count.documents > 0
  );

  return (
    <div>
      {/* Hero */}
      <header className="bg-gradient-to-br from-green-800 to-green-900 text-white px-4 py-10">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <Mountain size={32} className="text-green-300" />
            <div>
              <h1 className="text-3xl font-bold">Breadloaf Hill</h1>
              <p className="text-green-300 text-sm">Vermont Family Property</p>
            </div>
          </div>
          <p className="text-green-200">
            Your family property archive and assistant. Scan documents, browse
            records, and get answers about the property.
          </p>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/upload"
            className="flex items-center gap-3 bg-green-700 text-white rounded-xl p-4 hover:bg-green-800 transition-colors"
          >
            <Camera size={24} />
            <div>
              <p className="font-semibold">Scan</p>
              <p className="text-green-200 text-xs">Upload a document</p>
            </div>
          </Link>
          <Link
            href="/assistant"
            className="flex items-center gap-3 bg-amber-600 text-white rounded-xl p-4 hover:bg-amber-700 transition-colors"
          >
            <MessageCircle size={24} />
            <div>
              <p className="font-semibold">Ask</p>
              <p className="text-amber-200 text-xs">Property assistant</p>
            </div>
          </Link>
        </div>

        {/* Stats */}
        <div className="bg-white rounded-xl border border-stone-200 p-4">
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <p className="text-2xl font-bold text-stone-800">{docCount}</p>
              <p className="text-xs text-stone-500">Documents</p>
            </div>
            <div className="w-px h-10 bg-stone-200" />
            <div className="text-center flex-1">
              <p className="text-2xl font-bold text-stone-800">
                {categoriesWithDocs.length}
              </p>
              <p className="text-xs text-stone-500">Categories</p>
            </div>
            <div className="w-px h-10 bg-stone-200" />
            <div className="text-center flex-1">
              <p className="text-2xl font-bold text-stone-800">
                {bulletinMessages.length}
              </p>
              <p className="text-xs text-stone-500">Messages</p>
            </div>
          </div>
        </div>

        {/* Recent Documents */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-stone-800 flex items-center gap-2">
              <FileText size={18} />
              Recent Documents
            </h2>
            <Link
              href="/documents"
              className="text-green-700 text-sm flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {recentDocs.length === 0 ? (
            <div className="bg-stone-50 rounded-xl p-8 text-center">
              <FolderOpen size={32} className="mx-auto text-stone-300 mb-2" />
              <p className="text-stone-500 text-sm">No documents yet</p>
              <Link
                href="/upload"
                className="text-green-700 text-sm font-medium mt-1 inline-block"
              >
                Scan your first document
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentDocs.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="flex items-center gap-3 bg-white rounded-xl border border-stone-200 p-3 hover:shadow-sm transition-shadow"
                >
                  {doc.fileType.startsWith("image/") ? (
                    <div className="w-12 h-12 rounded-lg bg-stone-100 flex-shrink-0 overflow-hidden">
                      <img
                        src={doc.filePath}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-stone-50 flex-shrink-0 flex items-center justify-center">
                      <FileText size={20} className="text-stone-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-stone-800 truncate">
                      {doc.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
                      {doc.category && (
                        <span className="flex items-center gap-1">
                          <Tag size={10} />
                          {doc.category.name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />
                        {formatDate(doc.createdAt)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Bulletin Preview */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-stone-800 flex items-center gap-2">
              <Megaphone size={18} />
              Family Board
            </h2>
            <Link
              href="/bulletin"
              className="text-green-700 text-sm flex items-center gap-1"
            >
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {bulletinMessages.length === 0 ? (
            <div className="bg-stone-50 rounded-xl p-8 text-center">
              <Megaphone size={32} className="mx-auto text-stone-300 mb-2" />
              <p className="text-stone-500 text-sm">No messages yet</p>
              <Link
                href="/bulletin"
                className="text-green-700 text-sm font-medium mt-1 inline-block"
              >
                Post the first update
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {bulletinMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="bg-white rounded-xl border border-stone-200 p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-stone-700">
                      {msg.author}
                    </span>
                    <span className="text-xs text-stone-400">
                      {formatDate(msg.createdAt)}
                    </span>
                  </div>
                  <p className="text-stone-600 text-sm line-clamp-2">
                    {msg.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Categories Overview */}
        {categoriesWithDocs.length > 0 && (
          <div>
            <h2 className="font-semibold text-stone-800 mb-3 flex items-center gap-2">
              <FolderOpen size={18} />
              Categories
            </h2>
            <div className="flex flex-wrap gap-2">
              {categoriesWithDocs.map((cat) => (
                <Link
                  key={cat.id}
                  href={`/documents?category=${cat.slug}`}
                  className="bg-white border border-stone-200 rounded-full px-3 py-1.5 text-sm text-stone-600 hover:border-green-300 transition-colors"
                >
                  {cat.name}{" "}
                  <span className="text-stone-400">
                    ({cat._count.documents})
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
