import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AccountingSettingsData,
  UpdateAccountingSettingsInput,
} from "@cipansor/shared";
import api, { ApiResponse } from "@/lib/api";

const KEY = "accounting-settings";

export function useAccountingSettings(unitId?: string) {
  return useQuery({
    queryKey: [KEY, unitId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AccountingSettingsData>>(
        "/finance/accounting/settings",
        { params: { unitId } },
      );
      return response.data.data as AccountingSettingsData;
    },
    enabled: !!unitId,
  });
}

export function useUpdateAccountingSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAccountingSettingsInput) => {
      await api.post("/finance/accounting/settings", input);
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: [KEY, input.unitId],
      });
    },
  });
}
