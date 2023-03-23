export interface Environment {
    catalogItemName: string;
    catalogName: string;
    description?: string;
    environmentType: string;
    name: string;
    parameters: object;
    provisioningState: string;
    resourceGroupId: string;
    scheduledTasks: object;
    tags: object;
    user: string;
}
