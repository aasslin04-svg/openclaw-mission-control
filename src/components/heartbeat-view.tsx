"use client";

import { useTranslation } from "@/lib/i18n";
import { Heart } from "lucide-react";
import { SectionBody, SectionHeader, SectionLayout } from "@/components/section-layout";
import { HeartbeatManager } from "@/components/heartbeat-manager";

export function HeartbeatView() {
  const { t } = useTranslation();
  return (
    <SectionLayout>
      <SectionHeader
        title={
          <span className="flex items-center gap-2 text-xs">
            <Heart className="h-4 w-4 text-rose-400" />
            {t("Heartbeat")}
          </span>
        }
        description={t("Configure heartbeat defaults, per-agent overrides, visibility, and wake events.")}
      />
      <SectionBody width="content" padding="compact" innerClassName="space-y-4">
        <HeartbeatManager />
      </SectionBody>
    </SectionLayout>
  );
}
