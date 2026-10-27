package com.carddemo.ledger.domain.repository;

import com.carddemo.ledger.domain.model.EntryLine;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EntryLineRepository extends JpaRepository<EntryLine, Long> {

    List<EntryLine> findByEntryGroupId(String entryGroupId);
}
