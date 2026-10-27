package com.carddemo.ledger.domain.repository;

import com.carddemo.ledger.domain.model.EntryGroup;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EntryGroupRepository extends JpaRepository<EntryGroup, String> {
}
