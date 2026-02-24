import { z } from "zod";

export const PieSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  repoPath: z.string().min(1).nullable().optional(),
  createdAt: z.string().datetime()
});

export const CreatePieRequestSchema = z.object({
  name: z.string().min(1),
  repoPath: z.string().min(1).optional()
});
export type CreatePieRequest = z.infer<typeof CreatePieRequestSchema>;

export const ListPiesResponseSchema = z.object({
  pies: z.array(PieSchema)
});
export type ListPiesResponse = z.infer<typeof ListPiesResponseSchema>;

export const CreatePieResponseSchema = z.object({
  pie: PieSchema
});
export type CreatePieResponse = z.infer<typeof CreatePieResponseSchema>;

export const SliceResourceProtocolSchema = z.enum(["http", "tcp", "udp"]);

export const SliceResourceExposeSchema = z.enum(["primary", "subdomain", "none"]);

export const CreateSliceResourceSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "resource key must be lowercase alphanumeric with optional dashes"),
  protocol: SliceResourceProtocolSchema,
  expose: SliceResourceExposeSchema
});
export type CreateSliceResource = z.infer<typeof CreateSliceResourceSchema>;

export const SliceResourceSchema = CreateSliceResourceSchema.extend({
  allocatedPort: z.number().int().positive(),
  routeHost: z.string().min(1).optional(),
  routeUrl: z.string().url().optional()
});

export const SliceSchema = z.object({
  id: z.string().min(1),
  pieId: z.string().min(1),
  ordinal: z.number().int().positive(),
  host: z.string().min(1),
  worktreePath: z.string().min(1),
  branch: z.string().min(1),
  status: z.enum(["creating", "running", "stopped", "error"]),
  createdAt: z.string().datetime(),
  stoppedAt: z.string().datetime().nullable()
});

export const SliceWithResourcesSchema = SliceSchema.extend({
  resources: z.array(SliceResourceSchema)
});
export type SliceWithResources = z.infer<typeof SliceWithResourcesSchema>;

export const OrchestratedSliceSchema = SliceWithResourcesSchema.extend({
  pieSlug: z.string().min(1),
  routerPort: z.number().int().positive()
});

export const CreateSliceRequestSchema = z
  .object({
    pieId: z.string().min(1),
    worktreePath: z.string().min(1),
    branch: z.string().min(1).optional().default("main"),
    resources: z.array(CreateSliceResourceSchema).min(1)
  })
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const resource of value.resources) {
      if (keys.has(resource.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate resource key: ${resource.key}`
        });
      }
      keys.add(resource.key);
    }

    const primaryHttp = value.resources.filter((resource) => resource.protocol === "http" && resource.expose === "primary");
    if (primaryHttp.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at most one http resource can use expose=primary"
      });
    }
  });
export type CreateSliceRequest = z.infer<typeof CreateSliceRequestSchema>;

export const ListSlicesResponseSchema = z.object({
  slices: z.array(SliceWithResourcesSchema)
});
export type ListSlicesResponse = z.infer<typeof ListSlicesResponseSchema>;

export const CreateSliceResponseSchema = z.object({
  slice: OrchestratedSliceSchema
});
export type CreateSliceResponse = z.infer<typeof CreateSliceResponseSchema>;

export const SliceCreateOutputSchema = z.object({
  id: z.string().min(1),
  pieId: z.string().min(1),
  host: z.string().min(1),
  routerPort: z.number().int().positive(),
  url: z.string().url().nullable(),
  allocatedPorts: z.array(z.number().int().positive()).min(1),
  resources: z.array(SliceResourceSchema).min(1)
});
export type SliceCreateOutput = z.infer<typeof SliceCreateOutputSchema>;

export function toSliceCreateOutput(slice: CreateSliceResponse["slice"]): SliceCreateOutput {
  const primaryHttpResource = slice.resources.find((resource) => resource.protocol === "http" && resource.expose === "primary");

  return SliceCreateOutputSchema.parse({
    id: slice.id,
    pieId: slice.pieId,
    host: slice.host,
    routerPort: slice.routerPort,
    url: primaryHttpResource?.routeUrl ?? null,
    allocatedPorts: slice.resources.map((resource) => resource.allocatedPort),
    resources: slice.resources
  });
}

export const MutationOkResponseSchema = z.object({
  ok: z.literal(true)
});
export type MutationOkResponse = z.infer<typeof MutationOkResponseSchema>;

export const StatusResponseSchema = z.object({
  daemon: z.object({
    status: z.literal("ok"),
    host: z.string().min(1),
    port: z.number().int().nonnegative(),
    routerPort: z.number().int().positive()
  }),
  pies: z.object({
    total: z.number().int().nonnegative()
  }),
  slices: z.object({
    total: z.number().int().nonnegative(),
    byStatus: z.object({
      creating: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      stopped: z.number().int().nonnegative(),
      error: z.number().int().nonnegative()
    }),
    byPie: z.array(
      z.object({
        pieId: z.string().min(1),
        pieName: z.string().min(1),
        pieSlug: z.string().min(1),
        total: z.number().int().nonnegative(),
        running: z.number().int().nonnegative()
      })
    )
  }),
  generatedAt: z.string().datetime()
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;
