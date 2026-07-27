import { ButtonLink } from "@/components/ui/button-link";

const STEPS = [
  {
    number: "1",
    title: "Cuéntanos qué necesitas",
    description: "Describe el trabajo, elige la categoría y publica tu solicitud en pocos minutos.",
  },
  {
    number: "2",
    title: "Recibe presupuestos",
    description: "Los profesionales interesados y disponibles en tu zona te envían sus presupuestos.",
  },
  {
    number: "3",
    title: "Compara y elige",
    description: "Revisa perfiles, opiniones y presupuestos, y habla con el profesional antes de decidir.",
  },
  {
    number: "4",
    title: "Reserva y valora el servicio",
    description: "Agenda la cita, sigue el trabajo hasta su finalización y deja tu opinión.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="como-funciona" className="container flex flex-col gap-10 py-16 scroll-mt-20">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Cómo funciona</h2>
        <p className="max-w-2xl text-muted-foreground">
          De la solicitud al trabajo terminado, en cuatro pasos.
        </p>
      </div>

      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <div key={step.number} className="flex flex-col gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
              {step.number}
            </span>
            <h3 className="font-semibold text-foreground">{step.title}</h3>
            <p className="text-sm text-muted-foreground">{step.description}</p>
          </div>
        ))}
      </div>

      <div>
        <ButtonLink href="/requests/new" size="lg">
          Empezar ahora
        </ButtonLink>
      </div>
    </section>
  );
}
