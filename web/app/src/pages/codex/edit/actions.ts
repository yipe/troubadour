import { useNavigate } from "react-router"
import {
  useDeleteEntity,
  useMutateEntity,
  useRejectMisheard,
  useReviewEntity,
  useUnrejectMisheard,
  type Entity,
} from "@troubadour/api/campaign"
import { notify } from "@troubadour/ui/toast"
import { paths } from "../../../paths.ts"

const failure = (what: string) => (e: Error) => notify(`${what}: ${e.message}`, { tone: "danger" })

/** Accept or reject a spelling Troubadour suggested for this entry, through the atomic review endpoint. */
export function useHeardAsActions(entity: Entity) {
  const review = useReviewEntity()
  const reject = useRejectMisheard()
  const unreject = useUnrejectMisheard()
  return {
    accept: (heard: string) =>
      review.mutate(
        { name: entity.name, review: { accept_spellings: [heard] } },
        { onError: failure("Couldn't accept the spelling") },
      ),
    reject: (heard: string) =>
      reject.mutate(
        { suggested: entity.name, entity: entity.name, heard },
        {
          onSuccess: () =>
            notify(`"${heard}" isn't ${entity.name}`, {
              undo: () => unreject.mutate({ entity: entity.name, heard }),
            }),
          onError: failure("Couldn't reject the spelling"),
        },
      ),
  }
}

/** Keep (confirm) or delete an entry Troubadour suggested from a session. */
export function useSuggestedEntryActions(entity: Entity) {
  const mutate = useMutateEntity()
  const del = useDeleteEntity()
  const navigate = useNavigate()
  return {
    keep: () =>
      mutate.mutate(
        { name: entity.name, change: () => ({ status: "confirmed" }) },
        { onError: failure("Couldn't keep the entry") },
      ),
    remove: () =>
      del.mutate(entity.name, {
        onSuccess: () => navigate(paths.codex()),
        onError: failure("Couldn't delete the entry"),
      }),
  }
}
