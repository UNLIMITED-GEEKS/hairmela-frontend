import { Service } from '../../api/models/service';

export interface ServiceCategoryGroup<T> {
  id: string;
  name: string;
  sortOrder: number;
  items: T[];
}

// Groups any list of items that each carry a Service by that service's
// category, ordered by the category's sortOrder — same grouping used by
// salon-landing's Services tab and the service-settings list, extracted here
// as a third call site (service <select> dropdowns) needed the identical
// logic against a differently-shaped item (Service directly vs {service:
// Service, ...} wrappers like StaffService), hence the getService callback.
export function groupByServiceCategory<T>(
  items: readonly T[],
  getService: (item: T) => Service,
  customCategories: ReadonlyMap<string, string> = new Map(),
): ServiceCategoryGroup<T>[] {
  const groups = new Map<string, ServiceCategoryGroup<T>>();
  for (const item of items) {
    const service = getService(item);
    const cat = service.category ?? service.salonCategory;
    const id = cat?.id ?? service.salonCategoryId;
    if (!id) continue;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        name: cat?.name ?? customCategories.get(id) ?? id,
        sortOrder: service.category?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        items: [],
      };
      groups.set(id, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
