import { Header } from "@/components/layout/header";
import {
  Phone,
  AlertTriangle,
  Stethoscope,
  Flame,
  Wrench,
  Zap,
  PawPrint,
  Plus,
  Shield,
  Hospital,
} from "lucide-react";

interface ContactCard {
  name: string;
  phone?: string;
  description?: string;
  placeholder?: boolean;
}

interface ContactSection {
  title: string;
  icon: React.ReactNode;
  color: string;
  borderColor: string;
  bgColor: string;
  iconBg: string;
  contacts: ContactCard[];
}

const sections: ContactSection[] = [
  {
    title: "Medical",
    icon: <Stethoscope size={20} />,
    color: "text-blue-700",
    borderColor: "border-blue-200",
    bgColor: "bg-blue-50",
    iconBg: "bg-blue-100",
    contacts: [
      {
        name: "Poison Control",
        phone: "1-800-222-1222",
        description: "24/7 nationwide hotline",
      },
      {
        name: "Porter Medical Center",
        phone: "(802) 388-4701",
        description: "Nearest hospital — Middlebury, VT",
      },
    ],
  },
  {
    title: "Fire & Police",
    icon: <Shield size={20} />,
    color: "text-orange-700",
    borderColor: "border-orange-200",
    bgColor: "bg-orange-50",
    iconBg: "bg-orange-100",
    contacts: [
      {
        name: "Vermont State Police",
        phone: "(802) 388-4919",
        description: "New Haven barracks",
      },
      {
        name: "Ripton Volunteer Fire Department",
        description: "Local fire & EMS — call 911 for emergencies",
      },
    ],
  },
  {
    title: "Property Services",
    icon: <Wrench size={20} />,
    color: "text-amber-700",
    borderColor: "border-amber-200",
    bgColor: "bg-amber-50",
    iconBg: "bg-amber-100",
    contacts: [
      {
        name: "Plumber",
        placeholder: true,
      },
      {
        name: "Electrician",
        placeholder: true,
      },
      {
        name: "Septic Service",
        placeholder: true,
      },
      {
        name: "Propane Delivery",
        placeholder: true,
      },
    ],
  },
  {
    title: "Utilities",
    icon: <Zap size={20} />,
    color: "text-purple-700",
    borderColor: "border-purple-200",
    bgColor: "bg-purple-50",
    iconBg: "bg-purple-100",
    contacts: [
      {
        name: "Green Mountain Power",
        phone: "1-888-835-4672",
        description: "Electric utility — outage reporting",
      },
      {
        name: "Starlink",
        description: "Internet — manage via Starlink app",
      },
    ],
  },
  {
    title: "Veterinary",
    icon: <PawPrint size={20} />,
    color: "text-teal-700",
    borderColor: "border-teal-200",
    bgColor: "bg-teal-50",
    iconBg: "bg-teal-100",
    contacts: [
      {
        name: "Nearest Veterinarian",
        placeholder: true,
        description: "Add your preferred local vet",
      },
    ],
  },
];

export default function EmergencyPage() {
  return (
    <div>
      <Header
        title="Emergency Contacts"
        subtitle="Important numbers for the Breadloaf Hill property"
      />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Sections */}
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${section.color} flex items-center gap-2 mb-3`}>
              <span className={`w-8 h-8 rounded-lg ${section.iconBg} flex items-center justify-center`}>
                {section.icon}
              </span>
              {section.title}
            </h2>
            <div className="space-y-2">
              {section.contacts.map((contact) => (
                <div
                  key={contact.name}
                  className={`bg-white rounded-xl border ${section.borderColor} p-4`}
                >
                  {contact.placeholder ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-stone-800">
                          {contact.name}
                        </p>
                        {contact.description && (
                          <p className="text-sm text-stone-400 mt-0.5">
                            {contact.description}
                          </p>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm text-stone-400 bg-stone-100 rounded-lg px-3 py-1.5">
                        <Plus size={14} />
                        Add contact
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-stone-800">
                          {contact.name}
                        </p>
                        {contact.description && (
                          <p className="text-sm text-stone-500 mt-0.5">
                            {contact.description}
                          </p>
                        )}
                      </div>
                      {contact.phone && (
                        <a
                          href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`}
                          className={`inline-flex items-center gap-2 ${section.bgColor} ${section.color} rounded-lg px-3 py-2 text-sm font-medium hover:opacity-80 transition-opacity flex-shrink-0`}
                        >
                          <Phone size={14} />
                          {contact.phone}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Footer note */}
        <div className="text-center py-4">
          <p className="text-sm text-stone-400">
            3995 Vermont Route 125, Ripton, VT
          </p>
          <p className="text-xs text-stone-400 mt-1">
            Know a local contact to add? Let the family know on the{" "}
            <a href="/bulletin" className="text-green-700 hover:underline">
              Family Board
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
