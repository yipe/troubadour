import { useCampaigns } from "@troubadour/api/campaigns"

export const DEFAULT_TABLE_NAME = "The table"

/** What the party calls itself, or "The table" when the campaign has no name for it. */
export function tableName(campaign: { table_name?: string } | undefined): string {
  return campaign?.table_name?.trim() || DEFAULT_TABLE_NAME
}

/** The open campaign's table name. */
export function useTableName(): string {
  const data = useCampaigns().data
  return tableName(data?.campaigns.find((c) => c.id === data.campaign))
}
