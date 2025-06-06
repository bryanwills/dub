import { storage } from "@/lib/storage";
import { WorkspaceProps } from "@/lib/types";
import { prisma } from "@dub/prisma";
import {
  APP_DOMAIN_WITH_NGROK,
  DUB_DOMAINS_ARRAY,
  LEGAL_USER_ID,
  LEGAL_WORKSPACE_ID,
  R2_URL,
} from "@dub/utils";
import { waitUntil } from "@vercel/functions";
import { qstash } from "../cron";
import { cancelSubscription } from "../stripe/cancel-subscription";
import { markDomainAsDeleted } from "./domains";
import { linkCache } from "./links/cache";

export async function deleteWorkspace(
  workspace: Pick<WorkspaceProps, "id" | "slug" | "logo" | "stripeId">,
) {
  await Promise.all([
    // Remove the users
    prisma.projectUsers.deleteMany({
      where: {
        projectId: workspace.id,
      },
    }),

    // Remove the default workspace
    prisma.user.updateMany({
      where: {
        defaultWorkspace: workspace.slug,
      },
      data: {
        defaultWorkspace: null,
      },
    }),
  ]);

  waitUntil(
    Promise.all([
      // Remove the API keys
      prisma.restrictedToken.deleteMany({
        where: {
          projectId: workspace.id,
        },
      }),

      // Cancel the workspace's Stripe subscription
      workspace.stripeId && cancelSubscription(workspace.stripeId),

      // Delete workspace logo if it's a custom logo stored in R2
      workspace.logo &&
        workspace.logo.startsWith(`${R2_URL}/logos/${workspace.id}`) &&
        storage.delete(workspace.logo.replace(`${R2_URL}/`, "")),

      // queue the workspace for deletion
      queueWorkspaceDeletion({
        workspaceId: workspace.id,
      }),
    ]),
  );
}

export async function deleteWorkspaceAdmin(
  workspace: Pick<WorkspaceProps, "id" | "slug" | "logo" | "stripeId">,
) {
  while (true) {
    const defaultDomainLinks = await prisma.link.findMany({
      where: {
        projectId: workspace.id,
        domain: {
          in: DUB_DOMAINS_ARRAY,
        },
      },
      select: {
        id: true,
        domain: true,
        key: true,
      },
      take: 100,
    });

    if (defaultDomainLinks.length === 0) {
      break;
    }

    const [redisRes, prismaRes] = await Promise.allSettled([
      linkCache.expireMany(defaultDomainLinks),
      prisma.link.updateMany({
        where: {
          id: {
            in: defaultDomainLinks.map((link) => link.id),
          },
        },
        data: {
          projectId: LEGAL_WORKSPACE_ID,
          userId: LEGAL_USER_ID,
        },
      }),
    ]);

    console.log(
      `Banned ${defaultDomainLinks.length} default domain links for ${workspace.slug}`,
      redisRes,
      prismaRes,
    );
  }

  const customDomains = await prisma.domain.findMany({
    where: {
      projectId: workspace.id,
    },
    select: {
      slug: true,
    },
  });

  // delete all domains, links, and uploaded images associated with the workspace
  const deleteDomainsLinksResponse = await Promise.allSettled(
    customDomains.map(({ slug }) =>
      markDomainAsDeleted({
        domain: slug,
      }),
    ),
  );

  console.log(
    `Deleted ${customDomains.length} custom domains for ${workspace.slug}`,
    deleteDomainsLinksResponse,
  );

  const deleteWorkspaceResponse = await Promise.allSettled([
    // delete workspace logo if it's a custom logo stored in R2
    workspace.logo &&
      workspace.logo.startsWith(`${R2_URL}/logos/${workspace.id}`) &&
      storage.delete(workspace.logo.replace(`${R2_URL}/`, "")),
    // if they have a Stripe subscription, cancel it
    workspace.stripeId && cancelSubscription(workspace.stripeId),
    // delete the workspace
    prisma.project.delete({
      where: {
        slug: workspace.slug,
      },
    }),
  ]);

  console.log(`Deleted workspace ${workspace.slug}`, deleteWorkspaceResponse);

  return {
    deleteDomainsLinksResponse,
    deleteWorkspaceResponse,
  };
}

export async function queueWorkspaceDeletion({
  workspaceId,
  delay,
}: {
  workspaceId: string;
  delay?: number;
}) {
  return await qstash.publishJSON({
    url: `${APP_DOMAIN_WITH_NGROK}/api/cron/workspaces/delete`,
    ...(delay && { delay }),
    body: {
      workspaceId,
    },
  });
}
