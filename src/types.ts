export interface Environment {
    catalogName: string;
    environmentDefinitionName: string;
    environmentType: string;
    name: string;
    parameters: object;
    provisioningState: string;
    resourceGroupId: string;
    user: string;
}

export interface ResourceGroup {
    id: string;
    location: string;
    name: string;
    tags: object;
}

export interface Configuration {
    action: string;
    tenant: string;
    subscription: string;
    devcenter: string;
    project: string;
    catalog: string;
    definition: string;
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
    summary: boolean;
}

export interface ConfigurationFile {
    tenant?: string;
    subscription?: string;
    devcenter?: string;
    project?: string;
    catalog?: string;
    definition?: string;
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
    summary?: boolean;
}

export interface EnvironmentConfig {
    name: string;
    type: string;
}
