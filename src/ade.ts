import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as io from '@actions/io';
import { Environment } from './types';

export async function run(): Promise<void> {
    const getTenantIdCmd = ['account', 'show', '--query', 'tenantId', '--output', 'tsv'];
    const devcenterExtCmd = ['extension', 'add', '--name', 'devcenter', '--upgrade'];

    const cmdBase = ['devcenter', 'dev', 'environment'];

    try {
        const devcenter: string = core.getInput('devcenter', { required: true });
        if (!devcenter) {
            throw new Error('Input devcenter is required');
        }
        core.info(`Found input devcenter: ${devcenter}`);

        const project: string = core.getInput('project', { required: true });
        if (!project) {
            throw new Error('Input project is required');
        }
        core.info(`Found input project: ${project}`);

        const environmentName: string = core.getInput('environment-name', { required: true });
        if (!environmentName) {
            throw new Error('Input environment-name is required');
        }
        core.info(`Found input environment-name: ${environmentName}`);

        const az = await io.which('az', true);
        core.debug(`az cli path: ${az}`);

        let tenant: string = core.getInput('tenant', { required: false });
        if (tenant) {
            core.info(`Found input tenant: ${tenant}`);
        } else {
            core.info('Input tenant-id is not set, attempting to get it from the azure cli');
            const tenantId = await exec.getExecOutput(az, getTenantIdCmd);

            if (!tenantId.stdout) throw new Error(`Failed to get tenant id from Azure: ${tenantId.stderr}`);

            tenant = tenantId.stdout.trim();
            core.info(`Found tenant: ${tenant}`);
        }

        core.setOutput('tenant', tenant);

        core.info('Installing Azure CLI DevCenter extension');
        await exec.exec(az, devcenterExtCmd);

        const baseArgs = [
            '--only-show-errors',
            '--dev-center',
            devcenter,
            '--project',
            project,
            '--name',
            environmentName
        ];
        const showCmd = [...cmdBase, 'show', ...baseArgs];

        let exists = false;
        let created = false;
        let environment: Environment | undefined;

        const show = await exec.getExecOutput(az, showCmd, { ignoreReturnCode: true });

        if (show.exitCode === 0) {
            exists = true;
            core.debug('Found existing environment');
            environment = JSON.parse(show.stdout) as Environment;
        } else {
            const shouldCreate = core.getBooleanInput('create');
            core.info(`Input create: ${shouldCreate}`);

            if (shouldCreate) {
                core.info('Input create is true, attempting to create environment');

                const environmentType: string = core.getInput('environment-type', { required: true });
                if (!environmentType) {
                    throw new Error('Input environment-type is required to create environment');
                }
                core.info(`Found input environment-type: ${environmentType}`);

                const catalog: string = core.getInput('catalog', { required: true });
                if (!catalog) {
                    throw new Error('Input catalog is required to create environment');
                }
                core.info(`Found input catalog: ${catalog}`);

                const catalogItem: string = core.getInput('catalog-item', { required: true });
                if (!catalogItem) {
                    throw new Error('Input catalog-item is required to create environment');
                }
                core.info(`Found input catalog-item: ${catalogItem}`);

                const parameters: string = core.getInput('parameters', { required: false });
                if (parameters) core.info(`Found input parameters: ${parameters}`);

                const createCmd = [
                    ...cmdBase,
                    'create',
                    ...baseArgs,
                    '--environment-type',
                    environmentType,
                    '--catalog-name',
                    catalog,
                    '--catalog-item-name',
                    catalogItem,
                    '--parameters',
                    parameters
                ];

                const create = await exec.getExecOutput(az, createCmd, { ignoreReturnCode: true });

                if (create.exitCode === 0) {
                    exists = true;
                    created = true;
                    core.info('Created environment');
                    environment = JSON.parse(create.stdout) as Environment;
                } else {
                    throw Error(`Failed to create environment: ${create.stderr}`);
                }
            } else {
                core.info(`No existing environment found: code: ${show.exitCode}`);
            }
        }

        if (environment) {
            const groupId = environment.resourceGroupId;

            const resourceGroupKey = groupId.includes('/resourceGroups/') ? '/resourceGroups/' : '/resourcegroups/';

            const group = groupId.split(resourceGroupKey)[1].split('/')[0];
            const subscription = groupId.split('/subscriptions/')[1].split('/')[0];
            const portalUrl = `https://portal.azure.com/#@${tenant}/resource${groupId}`;

            core.setOutput('subscription', subscription);
            core.setOutput('resource-group', group);
            core.setOutput('resource-group-id', groupId);
            core.setOutput('portal-url', portalUrl);
        }

        core.setOutput('exists', exists);
        core.setOutput('created', created);
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message);
    }
}
