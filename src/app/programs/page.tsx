const programs = [
  {
    title: "Compliance Automation",
    description: "Automate regulatory compliance across jurisdictions with AI-driven monitoring.",
  },
  {
    title: "Contract Intelligence",
    description: "AI-powered contract analysis, drafting, and risk assessment.",
  },
  {
    title: "Financial Analytics",
    description: "Real-time financial insights and reporting with built-in legal context.",
  },
];

export default function ProgramsPage() {
  return (
    <div className="py-20 px-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-4">Solutions</h1>
        <p className="text-lg text-slate-600 mb-12">
          Explore the tools and services Finleg offers.
        </p>

        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {programs.map((program, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 p-6 hover:shadow-lg transition-shadow"
            >
              <h3 className="text-xl font-semibold mb-3">{program.title}</h3>
              <p className="text-slate-600">{program.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
