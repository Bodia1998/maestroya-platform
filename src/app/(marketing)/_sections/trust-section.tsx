import { MessageCircle, ScrollText, ShieldCheck, Star, Wrench, LifeBuoy } from "lucide-react";

/**
 * Trust signals — each one maps to a real, already-implemented platform
 * capability (verification module, quotes/quote items, chat, reviews,
 * job lifecycle, disputes/support). No invented statistics or fabricated
 * testimonials, per the brief.
 */
const TRUST_POINTS = [
  {
    icon: ShieldCheck,
    title: "Profesionales verificados",
    description:
      "Los profesionales pueden verificar su identidad y, en el caso de empresas, su documentación, antes de operar en la plataforma.",
  },
  {
    icon: ScrollText,
    title: "Presupuestos claros",
    description:
      "Recibe presupuestos detallados de varios profesionales y compáralos antes de decidir.",
  },
  {
    icon: MessageCircle,
    title: "Comunicación en la plataforma",
    description: "Habla con el profesional directamente desde MaestroYa antes y durante el servicio.",
  },
  {
    icon: Star,
    title: "Opiniones reales",
    description: "Cada trabajo finalizado puede recibir una reseña, visible en el perfil del profesional.",
  },
  {
    icon: Wrench,
    title: "Seguimiento del trabajo",
    description: "Consulta el estado de tu solicitud, cita y trabajo en todo momento desde tu panel.",
  },
  {
    icon: LifeBuoy,
    title: "Soporte si algo falla",
    description: "Si surge un problema, puedes abrir una incidencia y nuestro equipo de soporte te ayuda.",
  },
] as const;

export function TrustSection() {
  return (
    <section className="border-y border-border bg-muted/40">
      <div className="container flex flex-col gap-10 py-16">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Diseñado para que confíes en cada contratación
          </h2>
          <p className="max-w-2xl text-muted-foreground">
            MaestroYa está pensado para que sepas con quién estás hablando y qué estás
            contratando en todo momento.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST_POINTS.map((point) => (
            <div key={point.title} className="flex gap-4 rounded-xl bg-background p-5 shadow-xs">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <point.icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-foreground">{point.title}</h3>
                <p className="text-sm text-muted-foreground">{point.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
