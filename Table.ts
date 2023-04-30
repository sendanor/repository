// Copyright (c) 2023. Heusala Group Oy <info@heusalagroup.fi>. All rights reserved.

import { isFunction } from "../core/types/Function";
import { RepositoryMetadataUtils } from "./RepositoryMetadataUtils";
import { EntityMetadata } from "./types/EntityMetadata";

export const Table = (tableName: string) => {
    return (target: any) => {
        const TargetEntity = isFunction(target) ? target : undefined;
        RepositoryMetadataUtils.updateMetadata(target, (metadata: EntityMetadata) => {
            metadata.tableName = tableName;
            if (TargetEntity) {
                metadata.createEntity = (dto?: any) => new TargetEntity(dto);
            }
        });
    };
};