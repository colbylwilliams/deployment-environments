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
    id?: string;
    name?: string;
    subscription?: string;
    location?: string;
    tags?: object;
    url?: string;
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
    azd: boolean;
}

export interface ConfigurationFile {
    fileName?: string;
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
    azd?: boolean;
}

export interface AZDConfiguration {
    name?: string;
    resourceGroup?: string;
    metadata?: AZDMetadata;
    infra?: any;
    services?: any;
    pipeline?: any;
    hooks?: any;
    requiredVersions?: any;
    state?: any;
    platform?: AZDPlatform;
}

export interface AZDMetadata {
    template?: string;
}

export interface AZDPlatform {
    type: string;
    config?: AZDPlatformDevCenter;
}

export interface AZDPlatformDevCenter {
    name: string;
    project: string;
    catalog: string;
    environmentDefinition: string;
    environmentType: string;
}

export interface EnvironmentConfig {
    name: string;
    type: string;
}
