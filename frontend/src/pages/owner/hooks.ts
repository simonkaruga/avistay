import { useQuery } from "@tanstack/react-query";
import { api } from "../../utils/api";

export function useOwnerProperties() {
  return useQuery({
    queryKey: ["owner-properties"],
    queryFn: async () => {
      const res = await api("/properties/?owner=me");
      if (!res.ok) return [] as { id: string; title: string }[];
      return res.json() as Promise<{ id: string; title: string }[]>;
    },
  });
}
