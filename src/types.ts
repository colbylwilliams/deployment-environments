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

export interface Configuration {
    tenant: string;
    subscription: string;
    devcenter: string;
    project: string;
    catalog: string;
    catalogItem: string;
    parameters: string;
    prefix: string;
    suffix: string;
    mainBranch: string;
    devBranch: string;
    prodEnvironmentName: string;
    prodEnvironmentType: string;
    stagingEnvironmentType: string;
    testEnvironmentType: string;
    devEnvironmentType: string;
    create: boolean;
    environmentName: string;
    environmentType: string;
    action: string;
}

export interface ConfigurationFile {
    tenant?: string;
    subscription?: string;
    devcenter?: string;
    project?: string;
    catalog?: string;
    'catalog-item'?: string;
    parameters: string;
    prefix?: string;
    suffix?: string;
    'main-branch'?: string;
    'dev-branch'?: string;
    'prod-environment-name'?: string;
    'prod-environment-type'?: string;
    'staging-environment-type'?: string;
    'test-environment-type'?: string;
    'dev-environment-type'?: string;
}

export interface EnvironmentConfig {
    name: string;
    type: string;
}
